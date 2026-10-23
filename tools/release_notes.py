#!/usr/bin/env python3
"""生成 Release 说明（release-notes.md），可选地更新 changelog.md。

更新内容来自 git commit 标题（上一版 tag..HEAD），在发版工作流里调用：

    python3 tools/release_notes.py \
        --repo murongruyan/murongtouch \
        --version 5.0.1 --version-code 501 \
        --zip-name 慕容触控采样率-v5.0.1.zip \
        --sha256 <hex> --size <bytes> \
        --previous-tag v5.0.0 \
        --body release-notes.md \
        --changelog changelog.md

不传 --changelog 时只生成 Release 说明，不改仓库里的 changelog.md。
"""

from __future__ import annotations

import argparse
import datetime
import subprocess
import sys
from pathlib import Path

MAX_COMMITS = 40


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成 Release 说明/changelog")
    parser.add_argument("--repo", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--version-code", required=True)
    parser.add_argument("--zip-name", required=True)
    parser.add_argument(
        "--asset-name",
        default="",
        help="GitHub Release 资产名（ASCII）；为空时用 --zip-name",
    )
    parser.add_argument("--sha256", default="")
    parser.add_argument("--size", default="")
    parser.add_argument("--previous-tag", default="")
    parser.add_argument("--body", default="release-notes.md")
    parser.add_argument("--changelog", default="")
    return parser.parse_args()


def collect_commits(previous_tag: str) -> list[str]:
    revision_range = f"{previous_tag}..HEAD" if previous_tag else "HEAD"
    try:
        result = subprocess.run(
            ["git", "log", "--no-merges", "--pretty=format:%s", revision_range],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=True,
        )
    except subprocess.CalledProcessError as exc:  # pragma: no cover - 兜底
        print(f"[warn] git log 失败：{exc}", file=sys.stderr)
        return []
    commits = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        # 自动发版提交与 [skip ci] 提交不算用户可见更新
        if line.startswith("chore(release):") or "[skip ci]" in line:
            continue
        commits.append(line)
    return commits[:MAX_COMMITS]


def build_body(args: argparse.Namespace, commits: list[str]) -> str:
    if commits:
        changes = "\n".join(f"- {line}" for line in commits)
    else:
        changes = "- 维护性更新（无用户可见变更）"
    asset_name = args.asset_name or args.zip_name
    sha_line = f"- SHA256：`{args.sha256}`" if args.sha256 else ""
    size_line = f"- 大小：{args.size} bytes" if args.size else ""
    verify = "\n".join(x for x in (size_line, sha_line) if x) or "- 见 Release 资产"
    return (
        f"## 慕容触控采样率 v{args.version}\n\n"
        f"### 更新内容\n\n{changes}\n\n"
        "### 安装\n\n"
        f"1. 下载 Release 资产 `{asset_name}`（本地打包产物名为 `{args.zip_name}`；"
        "GitHub Release 资产名不支持中文，发布时使用 ASCII 资产名）；\n"
        "2. 打开 KernelSU / Magisk 管理器 → 模块 → 从本地安装，选择该 zip；\n"
        "3. 重启手机；打开模块 WebUI 配置采样率（`config/采样率.txt` 改完 1~2 秒热生效）。\n\n"
        "### 文件校验\n\n"
        f"{verify}\n\n"
        "### 说明\n\n"
        "> 本仓库与 Release 只包含**免费模块**。付费守护进程（自动切换采样率的核心组件）"
        "不在本仓库、也不在本 Release 中，由模块 WebUI 在购买授权后按需下载安装。\n"
    )


def update_changelog(path: Path, version: str, version_code: str, commits: list[str]) -> None:
    section_lines = [f"## v{version} ({version_code}) - {datetime.date.today().isoformat()}", ""]
    if commits:
        section_lines += [f"{i}. {line}" for i, line in enumerate(commits, 1)]
    else:
        section_lines.append("1. 维护性更新（无用户可见变更）。")
    section_lines.append("")

    if path.is_file():
        lines = path.read_text(encoding="utf-8").replace("\r\n", "\n").splitlines()
    else:
        lines = ["# 更新日志", ""]

    insert_at = next((i for i, line in enumerate(lines) if line.startswith("## ")), len(lines))
    if insert_at < len(lines) and insert_at > 0 and lines[insert_at - 1].strip() != "":
        section_lines.append("")
    new_lines = lines[:insert_at] + section_lines + lines[insert_at:]
    path.write_text("\n".join(new_lines).rstrip("\n") + "\n", encoding="utf-8", newline="\n")


def main() -> int:
    args = parse_args()
    commits = collect_commits(args.previous_tag)
    body = build_body(args, commits)
    body_path = Path(args.body)
    body_path.write_text(body, encoding="utf-8", newline="\n")
    print(f"release notes 已写入 {body_path}（{len(commits)} 条 commit）")
    if args.changelog:
        changelog_path = Path(args.changelog)
        update_changelog(changelog_path, args.version, args.version_code, commits)
        print(f"changelog 已更新 {changelog_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
