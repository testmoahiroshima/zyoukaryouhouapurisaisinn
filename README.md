# 浄化療法 実践サポートアプリ（データ＋開発指示）

3級講座の受講者が日常的に岡田式浄化療法を実践するためのサポートアプリの元データです。開発は Claude Code で行います（指示は `CLAUDE.md`）。

- `index.html`・`app/` … アプリ本体（GitHub Pages で動く静的Webアプリ）。本日の症状から、探査して見つめる箇所・毒素の流れ（矢印）・施術の大事なポイント・岡田先生の見解（症状から検索）を表示。探査の結果（熱・固結・圧痛）から施術の優先順位と時間配分を出し、タイマー・癒しの音楽・音声アドバイスで施術を支える
- `data/` … 探査部位19か所・症状ごとの毒素の流れ・早見表33経路・症状の言い回し辞書・安全判定・全集から読み取った知見・用語・施術記録スキーマ・岡田茂吉全集の索引
- `tools/test_engine.mjs` … 症状の照合テスト（`node tools/test_engine.mjs`）
- `tools/coverage.mjs` … 症状の言い方の取りこぼし確認（`node tools/coverage.mjs`）
- `tools/build_terms.py` … 症状の言葉→全集の参照先の索引を作る
- `tools/build_index.py` … 全集索引の再生成
- `docs/FIRST_PROMPT.md` … Claude Code に最初に渡す指示

根拠の一次資料：3級テキスト、岡田茂吉全集（https://london2311.github.io/okadamokidhizensyu/）

## 公開（GitHub Pages）
Settings → Pages → Branch: `main` / `(root)` を選ぶと、`https://testmoahiroshima.github.io/zyoukaryouhouapurisaisinn/` で開けます。
