#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
# Use the installed host runtimes; the optional SDK-bundled Python can stall
# on macOS even though the compiler itself is usable.
export EMSDK="${EMSDK:-$PWD/.tools/emsdk}"
export EMSDK_PYTHON="$(command -v python3)"
export EM_NODE_JS="$(command -v node)"
export EM_CONFIG="$EMSDK/.emscripten"
export PATH="$EMSDK/upstream/emscripten:$PATH"
make -C engine -j6 CC="$EMSDK/upstream/emscripten/emcc" CXX="$EMSDK/upstream/emscripten/em++"
make -C engine -j4 B=build/release-emscripten-wasm32 build/release-emscripten-wasm32/baseq3/vm/ui.qvm CC="$EMSDK/upstream/emscripten/emcc" CXX="$EMSDK/upstream/emscripten/em++"
python3 scripts/build_profile_bundle.py
cp engine/build/release-emscripten-wasm32/arena-wolfcam_opengl2.js public/engine/
cp engine/build/release-emscripten-wasm32/arena-wolfcam_opengl2.wasm public/engine/
mkdir -p public/profile/vm
cp engine/build/release-emscripten-wasm32/baseq3/vm/ui.qvm public/profile/vm/
python3 scripts/build_profile_bundle.py
