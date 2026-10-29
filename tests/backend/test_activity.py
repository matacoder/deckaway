import unittest

from integrations.activity import Activity, REDRAW_GRACE


class ActivityTests(unittest.TestCase):
    def test_a_resize_redraw_is_not_activity_but_later_output_is(self):
        activity, key = Activity(), ('api', '1')
        self.assertEqual(activity.shown(key, '100x30', 1000, 1000.5), 1000)
        self.assertEqual(activity.shown(key, '100x30', 1004, 1004.5), 1004)  # Ordinary output.
        # A phone attaches: the window shrinks and the agent redraws, seen in the same scan.
        self.assertEqual(activity.shown(key, '50x40', 1010, 1010.5), 1004)
        # The scan landed between the resize and the redraw: the next one still knows it was the resize.
        self.assertEqual(activity.shown(key, '100x30', 1020, 1020.0), 1004)
        self.assertEqual(activity.shown(key, '100x30', 1021, 1022.0), 1004)
        later = int(1020 + REDRAW_GRACE) + 1
        self.assertEqual(activity.shown(key, '100x30', later, later + 0.5), later)

    def test_closed_sessions_are_forgotten(self):
        activity = Activity()
        activity.shown(('a', '1'), '1x1', 5, 5)
        activity.shown(('b', '1'), '1x1', 5, 5)
        activity.forget({('b', '1')})
        self.assertEqual(set(activity.seen), {('b', '1')})
