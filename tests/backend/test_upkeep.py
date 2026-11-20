import unittest

from integrations.activity import Activity
from integrations.upkeep import QUIET, RESTART_AGE, Upkeep, typed

DAY = 86400
NOW = 100 * DAY


class UpkeepTests(unittest.TestCase):
    def setUp(self):
        self.settings, self.ages, self.screens, self.held = {}, {}, {}, set()
        self.list = []
        self.done = []
        self.upkeep = Upkeep(lambda: self.list, lambda: self.settings, self.ages.get,
                             lambda name: self.screens.get(name, ''), lambda name: name in self.held,
                             lambda s: s.get('sid') is not None, lambda name: self.done.append(('restart', name)),
                             lambda name: self.done.append(('sleep', name)), clock=lambda: NOW)

    def session(self, name, quiet, **extra):
        return {'name': name, 'agent': 'claude', 'running': True, 'activity': NOW - quiet, 'sid': 'x', **extra}

    def test_long_idle_agents_sleep_and_day_old_ones_restart_after_a_quiet_hour(self):
        self.list = [self.session('idle', 3 * DAY), self.session('old', QUIET), self.session('busy', 60),
                     self.session('young', 5 * QUIET), self.session('shell', 9 * DAY, agent='shell'),
                     self.session('stopped', 9 * DAY, running=False), self.session('win', 9 * DAY, runtime='windows'),
                     self.session('lost', 9 * DAY, sid=None)]
        self.ages.update(old=RESTART_AGE, busy=9 * DAY, young=RESTART_AGE - 1)
        self.assertEqual(self.upkeep.plan(), [('sleep', 'idle'), ('restart', 'old')])
        self.upkeep.tick()
        self.assertEqual(self.done, [('sleep', 'idle'), ('restart', 'old')])

    def test_what_the_owner_may_still_need_is_never_touched(self):
        self.list = [self.session('asks', 9 * DAY), self.session('draft', 9 * DAY), self.session('free', 9 * DAY)]
        self.held.add('asks')  # A question, a held prompt or a limit to continue after.
        self.screens['draft'] = '─────\n❯ \x1b[7mf\x1b[0mix the login page\n─────'
        self.screens['free'] = '─────\n❯ \x1b[7m \x1b[0m\x1b[2mTry "refactor"\x1b[0m\n─────'
        self.assertEqual(self.upkeep.plan(), [('sleep', 'free')])

    def test_the_owner_sets_the_days_or_turns_either_off(self):
        self.list = [self.session('idle', 3 * DAY), self.session('old', QUIET)]
        self.ages['old'] = RESTART_AGE
        self.settings.update(sleep_days=0, daily_restart=False)
        self.assertEqual(self.upkeep.plan(), [])
        self.settings.update(sleep_days=4, daily_restart=True)
        self.assertEqual(self.upkeep.plan(), [('restart', 'old')])  # Not asleep yet, but a day old.
        self.ages['idle'] = RESTART_AGE
        self.assertEqual(self.upkeep.plan(), [('restart', 'idle'), ('restart', 'old')])

    def test_one_failure_does_not_stop_the_rest(self):
        self.list = [self.session('a', 3 * DAY), self.session('b', 3 * DAY)]
        calls = []

        def sleep(name):
            calls.append(name)
            raise OSError('gone')
        self.upkeep.sleep = sleep
        self.upkeep.tick()
        self.assertEqual(calls, ['a', 'b'])

    def test_typed_text_is_told_from_a_suggestion_and_the_cursor(self):
        self.assertFalse(typed(''))
        self.assertFalse(typed('❯ \x1b[7m \x1b[0m'))
        self.assertFalse(typed('❯ \x1b[2mrun the tests\x1b[22m'))
        self.assertTrue(typed('❯ run the tests'))
        self.assertTrue(typed('› \x1b[1mship it\x1b[0m'))
        self.assertFalse(typed('❯ old text\nsome output\n❯ '))  # Only the last box counts.


class ActivityHoldTests(unittest.TestCase):
    def test_a_redraw_the_panel_caused_is_not_shown_as_work(self):
        activity = Activity()
        self.assertEqual(activity.shown(('a', '1'), '80x24', 100, 100), 100)
        activity.hold(('a', '1'), 190)
        self.assertEqual(activity.shown(('a', '1'), '80x24', 150, 150), 100)
        self.assertEqual(activity.shown(('a', '1'), '80x24', 200, 200), 200)


if __name__ == '__main__':
    unittest.main()
