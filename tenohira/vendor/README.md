# 掌の向き記録で使う画像認識の部品

- `mediapipe/vision_bundle.mjs`・`mediapipe/wasm/`：Google MediaPipe Tasks Vision 0.10.14（npm `@mediapipe/tasks-vision@0.10.14` から取り出したもの。Apache License 2.0）
- `../models/hand_landmarker.task`：手の21点のモデル（float16/1）
- `../models/pose_landmarker_lite.task`：骨格33点のモデル（lite・float16/1）
- `../models/person_detector_efficientdet_lite0.tflite`：人の検出（EfficientDet-Lite0・int8/1。COCO の person だけを使う）。顔に頼らないので、後ろ向き・暗い服で骨格が取れない人の位置を枠で取る。整数版なので CPU で動かす

いずれも元の配布物をそのまま置いています。外部のサイトに頼らずに読み込めるようにするためで、ここから読み込めない時だけ、`index.html` はインターネット（jsDelivr・Google）から読み込みます。版を上げる時は、部品とモデルを同じ版でそろえて入れ替え、`node tenohira/tenohira-geometry.test.mjs` で確かめてください。
