#!/usr/bin/env python3
"""Exercise SF property safety with mocked Android commands; never uses ADB."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
MODE = "debug.sf.use_phase_offsets_as_durations"
THRESHOLD = "debug.sf.phase_offset_threshold_for_next_vsync_ns"
LEGACY = [
    "debug.sf.early_phase_offset_ns",
    "debug.sf.early_gl_phase_offset_ns",
    "debug.sf.early_app_phase_offset_ns",
    "debug.sf.early_gl_app_phase_offset_ns",
    "debug.sf.high_fps_late_app_phase_offset_ns",
    "debug.sf.high_fps_late_sf_phase_offset_ns",
    "debug.sf.high_fps_early_phase_offset_ns",
    "debug.sf.high_fps_early_gl_phase_offset_ns",
    "debug.sf.high_fps_early_app_phase_offset_ns",
    "debug.sf.high_fps_early_gl_app_phase_offset_ns",
]
MOCK = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p = Path(os.environ["TEST_PROPERTY_STATE"])
state = json.loads(p.read_text())
name = Path(sys.argv[0]).name
args = sys.argv[1:]
if name == "getprop":
    print(state["props"].get(args[0], ""))
elif name in ("setprop", "resetprop"):
    key = args[0] if name == "setprop" else args[1]
    state["ops"].append([name] + args)
    if key == os.environ.get("TEST_FAIL_PROP"):
        p.write_text(json.dumps(state))
        sys.exit(1)
    if name == "setprop":
        state["props"][key] = args[1]
    else:
        assert args[0] == "--delete", args
        state["props"].pop(key, None)
    p.write_text(json.dumps(state))
elif name == "pidof":
    sys.exit(1)
elif name == "settings" and args[0] == "get":
    print("null")
'''


class SurfaceFlingerDurationGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="murongtouch-sf-guard-")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.bin = self.work / "mock-bin"
        self.bin.mkdir()
        for name in ("getprop", "setprop", "resetprop", "settings", "pidof", "service", "sleep"):
            executable = self.bin / name
            executable.write_text(MOCK, encoding="utf-8")
            executable.chmod(0o755)
        self.module = self.work / "module"
        (self.module / "bin").mkdir(parents=True)
        (self.module / "config").mkdir()
        self.data = self.work / "data"
        self.data.mkdir()
        for relative in ("common.sh", "bin/apply_touch_tuning.sh"):
            shutil.copyfile(ROOT / "module" / relative, self.module / relative)
        self.state = self.work / "props.json"
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "TEST_PROPERTY_STATE": str(self.state),
            "MOD_PATH": str(self.module),
            "DATA_DIR": str(self.data),
        }
        self.seed()

    def seed(self, mode="1", sdk="37", **overrides):
        props = {key: "35" for key in LEGACY}
        props.update({MODE: mode, "ro.build.version.sdk": sdk, THRESHOLD: "6100", "test.unrelated": "keep"})
        props.update(overrides)
        self.state.write_text(json.dumps({"props": props, "ops": []}), encoding="utf-8")

    def snapshot(self):
        return json.loads(self.state.read_text(encoding="utf-8"))

    def run_common(self, expected=0):
        result = subprocess.run(
            ["sh", "-c", '. "$1"; tweaks_apply -', "sh", str(self.module / "common.sh")],
            env=self.env, text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)

    def run_tuning(self, action="apply", expected=0):
        result = subprocess.run(
            ["sh", str(self.module / "bin/apply_touch_tuning.sh"), action],
            env=self.env, text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)

    def assert_duration_safe(self, expected_mode="1"):
        state = self.snapshot()
        self.assertEqual(state["props"].get(MODE), expected_mode)
        self.assertEqual(state["props"]["test.unrelated"], "keep")
        for key in LEGACY:
            self.assertIn(state["props"].get(key, ""), ("", "-1"), key)
        for op in state["ops"]:
            self.assertNotEqual(op[1], MODE, op)
            if op[0] == "setprop" and op[1] in LEGACY:
                self.assertIn(op[2], ("", "-1"), op)

    def test_defaults_clear_all_ten_conflicts_in_duration_modes(self):
        for mode, sdk in (("1", "37"), ("true", "36"), ("TRUE", "37"), ("yes", "37"), ("on", "37"), ("", "37")):
            with self.subTest(mode=mode, sdk=sdk):
                self.seed(mode=mode, sdk=sdk)
                self.run_common()
                self.assert_duration_safe(expected_mode=mode)
                self.assertEqual(self.snapshot()["props"][THRESHOLD], "6100")

    def test_explicit_legacy_and_older_system_keep_previous_defaults(self):
        for mode, sdk in (("0", "37"), ("false", "36"), ("", "36")):
            with self.subTest(mode=mode, sdk=sdk):
                self.seed(mode=mode, sdk=sdk)
                self.run_common()
                props = self.snapshot()["props"]
                self.assertEqual(props["debug.sf.early_phase_offset_ns"], "35")
                self.assertEqual(props["debug.sf.early_gl_phase_offset_ns"], "0")
                self.assertEqual(props["debug.sf.high_fps_early_phase_offset_ns"], "6100")
                self.assertEqual(props[MODE], mode)

    def test_custom_config_cannot_bypass_guard_or_disable_duration_mode(self):
        lines = ["use_phase_offsets_as_durations=0"]
        lines += [f"{key.removeprefix('debug.sf.')}=9999" for key in LEGACY]
        lines += ["phase_offset_threshold_for_next_vsync_ns=7100"]
        (self.data / "touch_tuning.conf").write_text("\n".join(lines) + "\n", encoding="utf-8")
        self.run_tuning()
        self.assert_duration_safe()
        self.assertEqual(self.snapshot()["props"][THRESHOLD], "7100")

    def test_negative_one_remains_an_allowed_sentinel(self):
        self.seed(**{LEGACY[0]: "-1"})
        (self.data / "touch_tuning.conf").write_text(
            "\n".join(f"{key.removeprefix('debug.sf.')}=-1" for key in LEGACY) + "\n",
            encoding="utf-8",
        )
        self.run_tuning()
        self.assert_duration_safe()
        self.assertTrue(all(self.snapshot()["props"][key] == "-1" for key in LEGACY))

    def test_no_config_still_cleans_previous_module_values(self):
        self.run_tuning()
        self.assert_duration_safe()

    def test_setprop_empty_fallback_without_resetprop(self):
        (self.bin / "resetprop").unlink()
        self.run_common()
        self.assert_duration_safe()

    def test_cleanup_failure_is_reported_without_rewriting_legacy_values(self):
        self.env["TEST_FAIL_PROP"] = LEGACY[0]
        self.run_common(expected=1)
        for op in self.snapshot()["ops"]:
            if op[0] == "setprop" and op[1] in LEGACY:
                self.assertEqual(op[2], "", op)

    def test_restore_preserves_duration_switch_and_covers_all_ten_keys(self):
        self.run_tuning(action="restore")
        self.assert_duration_safe()

    def test_missing_common_library_refuses_unguarded_writes(self):
        (self.module / "common.sh").unlink()
        self.run_tuning(expected=1)
        self.assertEqual(self.snapshot()["ops"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
