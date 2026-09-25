The C++ WebGPU JSI API in this directory comes from
`wcandillon/react-native-webgpu` at commit
`e2735d77720b9903772d4d9e5d83bc3a3a27498c`.

Source: https://github.com/wcandillon/react-native-webgpu/tree/e2735d77720b9903772d4d9e5d83bc3a3a27498c/packages/webgpu/cpp
License: MIT; see `LICENSE`.

Linux/Valdi changes:

- `ReactCommon/CallInvoker.h` is a small ABI-compatible interface shim for
  the two invoker methods this package uses. Valdi supplies the implementation.
- `rnwgpu/async/RuntimeContext.*` uses a weak process registry because Valdi's
  pinned Hermes JSI does not yet provide `RuntimeData` and `jsi::UUID`.
  `RNWebGPUManager` unregisters its runtime before Valdi destroys Hermes.

The video and mobile platform methods remain in the upstream interface. A
Linux platform adapter will implement the methods needed by WorldOS; the
current request-adapter probe does not use platform image or video methods.
