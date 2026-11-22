import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from integrations.telegram import Telegram
from integrations.telegram_decisions import EVERY, DecisionRelay
from test_telegram import TOKEN, FakeAPI, question

DECK = 'a' * 24


def decision(identity, **extra):
    return {'id': identity, 'session': 'duty', 'title': 'Duty', 'question': 'Ship tonight?', 'context': 'Tests pass.',
            'options': ['Yes', 'Later'], 'status': 'open', 'live': True, **extra}


class DecisionRelayTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(dir='/tmp')
        self.addCleanup(tmp.cleanup)
        self.api = FakeAPI()
        self.service = Telegram(Path(tmp.name), lambda: [], Mock(), self.api)
        self.service.start = Mock()
        self.service.save({'token': TOKEN})
        status = self.service.pair()
        code = status['pair_url'].split('?start=deck_', 1)[1]
        self.service.handle({'message': {'text': '/start deck_' + code, 'chat': {'id': 100, 'type': 'private'},
                                         'from': {'id': 100, 'username': 'tester'}}})
        self.found = {'': [decision('h1')], DECK: [decision('r1', title='Remote duty')]}
        self.answers, self.now = [], 1000.0
        self.relay = DecisionRelay(self.service, lambda: self.found, lambda *args: self.answers.append(args),
                                   lambda deck: 'Mac Studio' if deck else '', clock=lambda: self.now)
        self.service.decisions = self.relay

    def deliver(self):
        self.now += EVERY
        self.relay.deliver()

    def sent(self):
        return [d for m, d in self.api.calls if m == 'sendMessage' and 'reply_markup' in d]

    def calls(self, method):
        return [d for m, d in self.api.calls if m == method]

    def tap(self, message_id, data, user=100):
        return self.service.handle({'callback_query': {'id': 'cb', 'from': {'id': user}, 'data': data,
                                    'message': {'message_id': message_id, 'chat': {'id': 100, 'type': 'private'}}}})

    def test_every_open_decision_of_every_computer_is_one_message_with_its_answers(self):
        self.found[''].append(decision('closed', live=False))
        self.deliver(); self.deliver()
        sent = self.sent()
        self.assertEqual(len(sent), 2)
        self.assertIn('Ship tonight?', sent[1]['text'])
        self.assertIn('Remote duty · Mac Studio', sent[1]['text'])
        self.assertEqual([b[0]['text'] for b in sent[0]['reply_markup']['inline_keyboard']], ['1. Yes', '2. Later'])

    def test_a_tap_answers_on_its_computer_and_the_message_leaves_the_chat(self):
        self.deliver()
        row = self.service.database().decision_row('ref', DECK + '/r1')
        self.tap(row['message_id'], f"d:{row['id']}:1", user=999)  # Not the owner.
        self.assertEqual(self.answers, [])
        self.tap(row['message_id'], f"d:{row['id']}:1")
        self.assertEqual(self.answers, [(DECK, 'r1', 'Later')])
        self.assertEqual(self.calls('deleteMessage'), [{'chat_id': 100, 'message_id': row['message_id']}])
        self.tap(row['message_id'], f"d:{row['id']}:0")  # Never twice.
        self.assertEqual(len(self.answers), 1)

    def test_a_reply_is_the_answer_and_both_messages_go(self):
        self.deliver()
        row = self.service.database().decision_row('ref', '/h1')
        self.service.handle({'message': {'message_id': 77, 'text': 'After the release', 'chat': {'id': 100, 'type': 'private'},
                                         'from': {'id': 100}, 'reply_to_message': {'message_id': row['message_id']}}})
        self.assertEqual(self.answers, [('', 'h1', 'After the release')])
        self.assertEqual([d['message_id'] for d in self.calls('deleteMessage')], [row['message_id'], 77])

    def test_answered_elsewhere_it_is_deleted_but_a_silent_computer_keeps_its_messages(self):
        self.deliver()
        here = self.service.database().decision_row('ref', '/h1')['message_id']
        self.found = {'': []}  # The remote computer did not answer this time.
        self.deliver()
        self.assertEqual([d['message_id'] for d in self.calls('deleteMessage')], [here])
        self.assertIsNotNone(self.service.database().decision_row('ref', DECK + '/r1'))

    def test_filed_again_with_other_words_the_message_is_edited(self):
        self.deliver()
        self.found[''] = [decision('h1', question='Ship on Monday?')]
        self.deliver()
        self.assertIn('Ship on Monday?', self.calls('editMessageText')[0]['text'])
        self.assertEqual(len(self.sent()), 2)

    def test_an_answered_screen_question_is_deleted_too(self):
        self.service.scan = lambda: [question()]
        self.service.deliver()
        row = self.service.database().pending()[0]
        self.tap(row['message_id'], f"q:{row['id']}:1")
        self.assertIn({'chat_id': 100, 'message_id': row['message_id']}, self.calls('deleteMessage'))


if __name__ == '__main__':
    unittest.main()
