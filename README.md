# 浄化療法 実践サポートアプリ（データ＋開発指示）

3級講座の受講者が日常的に岡田式浄化療法を実践するためのサポートアプリの元データです。開発は Claude Code で行います（指示は `CLAUDE.md`）。

- `data/` … 探査部位・症状ごとの毒素の流れ・用語・施術記録スキーマ・岡田茂吉全集の索引
- `tools/build_index.py` … 全集索引の再生成
- `docs/FIRST_PROMPT.md` … Claude Code に最初に渡す指示

根拠の一次資料：3級テキスト、岡田茂吉全集（https://london2311.github.io/okadamokidhizensyu/）
