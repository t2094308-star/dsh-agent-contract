#!/bin/bash
# 薄包装喵：真正的实现在 verify-node.mjs 里（DESIGN §9-16）。
# dsh 沙箱禁命名管道，Git Bash / WSL 会报 `couldn't create signal pipe`，
# 所以 canonical 套件的入口必须是纯 Node 的 —— 这里只是给习惯用 bash 的人留个门喵。
exec node "$(dirname "$0")/verify-node.mjs" "$@"
