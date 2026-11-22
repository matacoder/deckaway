"""Decisions agents filed for their owner (decisions.py), duplicated into the owner's Telegram chat.

Every open decision of every computer is one message: the question, its context, where it comes from, a button
per offered answer and a reply for one's own words. An answer from Telegram is kept on the decision's computer
and typed into its session there, as "Send" in the panel does. A message whose decision is no longer open
(answered anywhere, dismissed, done) is deleted from the chat; a computer that did not answer a scan keeps its
messages. A row is written before its message is sent, so a crash never sends one twice.
"""
import hashlib
import json
import re
import time

EVERY = 10
QUESTION_CHARS, CONTEXT_CHARS, BUTTON_CHARS = 900, 2500, 60
CALLBACK = re.compile(r'd:(\d{1,12}):([0-7])')


class DecisionRelay:
    def __init__(self, telegram, scan, answer, names=lambda deck: '', clock=time.monotonic):
        """scan() -> {computer id ('' here): [decisions]} for the computers that answered; answer(deck, id, text)
        keeps and sends one answer; names(deck): the computer's name for the message."""
        self.telegram, self.scan, self.answer, self.names, self.clock = telegram, scan, answer, names, clock
        self.checked = None

    def deliver(self):
        if self.checked is not None and self.clock() - self.checked < EVERY:
            return
        self.checked = self.clock()
        with self.telegram.lock:
            c = self.telegram.config.copy()
        if not self.telegram.eligible(c):
            return
        found = self.scan()
        db = self.telegram.database()
        waiting = {f'{deck}/{item["id"]}': (deck, item) for deck, items in found.items() for item in items
                   if item.get('status') == 'open' and item.get('live')}
        for row in db.decision_rows():
            if row['deck'] in found and row['ref'] not in waiting and row['status'] != 'sending':
                if row['message_id'] and row['status'] == 'sent':  # An answered one went at the answer.
                    self.telegram.retire(c, row['message_id'])
                db.forget_decision(row['ref'])
        for ref, (deck, item) in waiting.items():
            self.show(c, db, ref, deck, item)

    def show(self, c, db, ref, deck, item):
        text = self.message(deck, item)
        shown = hashlib.sha256(text.encode()).hexdigest()
        row = db.decision_row('ref', ref)
        if row and row['status'] == 'sent' and row['shown'] != shown:
            # The agent filed it again with other words: the same message says the new ones.
            db.decision_status(ref, 'sent', shown=shown, options=json.dumps(item['options'], ensure_ascii=False))
            self.telegram.notify(c['token'], 'editMessageText', chat_id=c['chat_id'], message_id=row['message_id'],
                                 text=text, reply_markup={'inline_keyboard': self.buttons(row['id'], item)})
            return
        if row or not db.claim_decision(ref, deck, item['id'], item['options'], shown):
            return
        row = db.decision_row('ref', ref)
        try:
            result = self.telegram.api.call(c['token'], 'sendMessage', chat_id=c['chat_id'], text=text,
                                            reply_markup={'inline_keyboard': self.buttons(row['id'], item)})
        except Exception as error:
            # A lost answer may hide a sent message; only a clear refusal is tried again.
            if getattr(error, 'uncertain', True):
                db.decision_status(ref, 'uncertain')
            else:
                db.forget_decision(ref)
            raise
        db.decision_status(ref, 'sent', message_id=result['message_id'])

    def message(self, deck, item):
        where = ' · '.join(filter(None, (item.get('title') or item.get('session'), self.names(deck))))
        parts = [item['question'][:QUESTION_CHARS], (item.get('context') or '')[:CONTEXT_CHARS], where,
                 self.telegram.translate('Свой ответ: ответьте на это сообщение текстом')]
        return '\n\n'.join(part for part in parts if part)

    def buttons(self, row_id, item):
        return [[{'text': f'{i + 1}. {option[:BUTTON_CHARS]}', 'callback_data': f'd:{row_id}:{i}'}]
                for i, option in enumerate(item['options'][:8])]

    def callback(self, c, data, message_id):
        """A tapped option -> the text for the tap's notice, or None when the data is not a decision's."""
        match = CALLBACK.fullmatch(data or '')
        if not match:
            return None
        row = self.telegram.database().decision_row('id', int(match[1]))
        if not row or row['message_id'] != message_id:
            return 'Эта кнопка недоступна'
        options = json.loads(row['options'])
        if int(match[2]) >= len(options):
            return 'Неверный вариант ответа'
        return self.reply_with(c, row, options[int(match[2])])

    def reply(self, c, reply_to, text):
        """A reply to a decision's message -> what to tell the owner ('' when it went), or None when not one."""
        row = self.telegram.database().decision_row('message_id', reply_to)
        if not row:
            return None
        if len(text) > 4000:
            return 'Ответ длиннее 4000 символов'
        return self.reply_with(c, row, text)

    def reply_with(self, c, row, text):
        db = self.telegram.database()
        if not db.decision_status(row['ref'], 'answering', before='sent'):
            return 'Этот вопрос не найден или уже закрыт'
        try:
            self.answer(row['deck'], row['decision'], text)
        except ValueError as error:
            db.decision_status(row['ref'], 'sent')
            return str(error)
        except Exception:
            db.decision_status(row['ref'], 'uncertain')
            return 'Проверьте ответ в панели: повторная отправка отключена'
        db.decision_status(row['ref'], 'answered')
        self.telegram.retire(c, row['message_id'])
        return ''
