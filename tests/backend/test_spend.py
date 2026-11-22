import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from integrations.spend import Spend

NOW = datetime(2026, 11, 22, 12).timestamp()


def stamp(day, hour=12):
    return datetime(2026, 11, day, hour).astimezone().isoformat()


def answer(message, day, input=1, write=10, read=100, output=5, model='claude-x', side=False):
    return {'type': 'assistant', 'timestamp': stamp(day), 'isSidechain': side,
            'message': {'id': message, 'model': model, 'usage': {
                'input_tokens': input, 'cache_creation_input_tokens': write,
                'cache_read_input_tokens': read, 'output_tokens': output}}}


def codex(day, total, last):
    return {'timestamp': stamp(day), 'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {
        'total_token_usage': {'total_tokens': total},
        'last_token_usage': {'input_tokens': last, 'cached_input_tokens': last // 2, 'output_tokens': 3}}}}


class SpendTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.files = {}
        self.list = []
        self.spend = Spend(lambda: self.list, lambda agent, sid: self.files.get(sid), clock=lambda: NOW)

    def tearDown(self):
        self.dir.cleanup()

    def write(self, path, records, mode='w'):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open(mode) as stream:
            for record in records:
                stream.write(json.dumps(record) + '\n')

    def test_a_day_adds_up_every_answer_once_with_the_agents_it_started(self):
        main = self.root / 'a.jsonl'
        # One answer spread over several records (text, tool call) carries the same usage: counted once.
        self.write(main, [answer('m1', 21), answer('m2', 22), answer('m2', 22), answer('m3', 22, model='<synthetic>'),
                          {'type': 'user', 'timestamp': stamp(22)}])
        self.write(self.root / 'a' / 'subagents' / 'agent-1.jsonl', [answer('s1', 22, read=1000, side=True)])
        self.files['a'] = main
        self.list = [{'name': 'duty', 'created': 1, 'agent': 'claude', 'sid': 'a'}]
        self.spend.check()
        self.assertEqual(self.spend.of('duty', 1), {
            'day': '2026-11-22', 'today': {'input': 2, 'cache_write': 20, 'cache_read': 1100, 'output': 10},
            'yesterday': 116, 'running': None})
        # Only what was appended is read; a half-written line waits for the next pass.
        with main.open('a') as stream:
            stream.write(json.dumps(answer('m4', 22)) + '\n' + '{"type": "assist')
        self.spend.check()
        self.assertEqual(self.spend.of('duty', 1)['today']['cache_read'], 1200)

    def test_a_session_keeps_its_earlier_conversations_and_forgets_a_closed_one(self):
        self.write(self.root / 'a.jsonl', [answer('m1', 22)])
        self.write(self.root / 'b.jsonl', [answer('m1', 22)])
        self.files.update(a=self.root / 'a.jsonl', b=self.root / 'b.jsonl')
        self.list = [{'name': 'duty', 'created': 1, 'agent': 'claude', 'sid': 'a'}]
        self.spend.check()
        self.list = [{'name': 'duty', 'created': 1, 'agent': 'claude', 'sid': 'b'}]  # After a /clear.
        self.spend.check()
        self.assertEqual(sum(self.spend.of('duty', 1)['today'].values()), 232)
        self.list = [{'name': 'duty', 'created': 2, 'agent': 'claude', 'sid': None}]  # A new session of that name.
        self.spend.check()
        self.assertIsNone(self.spend.of('duty', 1))
        self.assertIsNone(self.spend.of('duty', 2))

    def test_a_session_carries_when_its_agent_was_last_started(self):
        self.spend.starts = lambda: {'duty': 1700, 'other': 5}
        self.list = [{'name': 'duty', 'created': 1, 'agent': 'shell', 'sid': None}]
        self.spend.check()
        self.assertEqual(self.spend.of('duty', 1)['running'], 1700)  # No tokens, still its start.
        self.spend.starts = lambda: (_ for _ in ()).throw(OSError())
        self.spend.check()
        self.assertIsNone(self.spend.of('duty', 1))  # The process list failed: nothing made up.

    def test_codex_counts_each_turn_from_its_running_total(self):
        self.write(self.root / 'r.jsonl', [codex(22, 100, 100), codex(22, 100, 100), codex(22, 150, 50)])
        self.files['r'] = self.root / 'r.jsonl'
        self.list = [{'name': 'cx', 'created': 1, 'agent': 'codex', 'sid': 'r'}]
        self.spend.check()
        self.assertEqual(self.spend.of('cx', 1)['today'], {'input': 75, 'cache_write': 0, 'cache_read': 75, 'output': 6})


if __name__ == '__main__':
    unittest.main()
