#!/usr/bin/env python3
"""同步发布元数据：改写 module/module.prop 并生成仓库根 update.json。

在发版工作流里被调用（也用于手动修版本号）：

    python3 tools/update_metadata.py \
        --module-dir module \
        --version 5.0.1 --version-code 501 \
        --repo murongruyan/murongtouch \
        --branch main \
        --zip-name 慕容触控采样率-v5.0.1.zip \
        --asset-name murongtouch-v5.0.1.zip

module.prop 会写入 version / versionCode / updateJson（缺失 updateJson 时追加），
update.json 按显示模块（murongchaopin）的 updateJson 字段格式写出：
    { "version", "versionCode", "zipUrl", "changelog" }
zipUrl 指向 GitHub Release 的 ASCII 资产名（GitHub 会丢弃资产名中的中文，
所以发布时把本地构建的 慕容触控采样率-vX.Y.Z.zip 复制为 murongtouch-vX.Y.Z.zip 再上传）。
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from pathlib import Path

UPDATE_FIELDS = ("version", "versionCode", "updateJson")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="同步 module.prop 与 update.json")
    parser.add_argument("--module-dir", default="module", help="模块目录（含 module.prop）")
    parser.add_argument("--version", required=True)
    parser.add_argument("--version-code", required=True, type=int)
    parser.add_argument("--repo", required=True, help="owner/name，例如 murongruyan/murongtouch")
    parser.add_argument("--branch", default="main")
    parser.add_argument(
        "--zip-name",
        required=True,
        help="给人看的 zip 文件名（本地构建产物，如 慕容触控采样率-v5.0.1.zip）",
    )
    parser.add_argument(
        "--asset-name",
        default="",
        help="GitHub Release 资产名（必须是 ASCII，GitHub 会丢弃资产名中的中文）；"
        "默认与 --zip-name 相同",
    )
    parser.add_argument("--update-json", default="update.json")
    parser.add_argument("--changelog", default="changelog.md")
    return parser.parse_args()


def update_module_prop(path: Path, version: str, version_code: int, update_json_url: str) -> None:
    if not path.is_file():
        raise SystemExit(f"缺少 {path}")
    raw = path.read_text(encoding="utf-8")
    lines = raw.replace("\r\n", "\n").splitlines()
    values = {
        "version": version,
        "versionCode": str(version_code),
        "updateJson": update_json_url,
    }
    out, seen = [], set()
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line else None
        if key in values:
            out.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            out.append(line)
    for key in UPDATE_FIELDS:
        if key not in seen:
            out.append(f"{key}={values[key]}")
    path.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8", newline="\n")


def build_update_json(repo: str, branch: str, version: str, version_code: int, asset_name: str) -> dict:
    encoded_zip = urllib.parse.quote(asset_name, safe="")
    return {
        "version": version,
        "versionCode": version_code,
        "zipUrl": f"https://github.com/{repo}/releases/download/v{version}/{encoded_zip}",
        "changelog": f"https://raw.githubusercontent.com/{repo}/{branch}/changelog.md",
    }


def main() -> int:
    args = parse_args()
    module_dir = Path(args.module_dir)
    update_json_url = (
        f"https://raw.githubusercontent.com/{args.repo}/{args.branch}/update.json"
    )
    update_module_prop(module_dir / "module.prop", args.version, args.version_code, update_json_url)

    data = build_update_json(
        args.repo,
        args.branch,
        args.version,
        args.version_code,
        args.asset_name or args.zip_name,
    )
    update_path = Path(args.update_json)
    update_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )

    print(f"module.prop: version={args.version} versionCode={args.version_code}")
    print(f"updateJson  -> {update_json_url}")
    print(f"{update_path}:")
    print(update_path.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
