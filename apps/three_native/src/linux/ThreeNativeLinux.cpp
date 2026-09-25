#include "valdi/linux/LinuxRuntime.hpp"
#include "valdi/standalone_runtime/StandaloneMainQueue.hpp"
#include "valdi/standalone_runtime/StandaloneView.hpp"
#include "valdi_core/cpp/Events/TouchEvents.hpp"
#include "valdi_core/cpp/Utils/StringCache.hpp"
#include "valdi_core/cpp/Utils/ValueFunction.hpp"
#include "valdi_core/cpp/Utils/ValueTypedArray.hpp"

#define SDL_MAIN_HANDLED
#include <SDL2/SDL.h>
#include <GLES3/gl3.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <unordered_set>
#include <utility>
#include <vector>

namespace {

constexpr const char* kComponentPath = "App@three_native/src/ThreeNativeApp";
constexpr int kInitialWidth = 600;
constexpr int kInitialHeight = 800;
constexpr int kFloatsPerVertex = 6;

constexpr const char* kVertexShader = R"(#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uMvp;
uniform mat4 uModel;
out float vLight;
void main() {
    vec3 normal = normalize(mat3(uModel) * aNormal);
    vLight = 0.35 + 0.65 * abs(dot(normal, normalize(vec3(-0.3, 0.6, 1.0))));
    gl_Position = uMvp * vec4(aPosition, 1.0);
}
)";

constexpr const char* kFragmentShader = R"(#version 300 es
precision mediump float;
in float vLight;
out vec4 color;
void main() {
    color = vec4(vec3(0.37, 0.68, 0.96) * vLight, 1.0);
}
)";

GLuint compileShader(GLenum type, const char* source) {
    const GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, nullptr);
    glCompileShader(shader);
    GLint compiled = GL_FALSE;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
    if (compiled != GL_TRUE) {
        std::array<char, 2048> log{};
        glGetShaderInfoLog(shader, static_cast<GLsizei>(log.size()), nullptr, log.data());
        std::fprintf(stderr, "Three Linux shader compilation failed: %s\n", log.data());
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

GLuint createProgram() {
    const GLuint vertex = compileShader(GL_VERTEX_SHADER, kVertexShader);
    if (vertex == 0) return 0;
    const GLuint fragment = compileShader(GL_FRAGMENT_SHADER, kFragmentShader);
    if (fragment == 0) {
        glDeleteShader(vertex);
        return 0;
    }
    const GLuint program = glCreateProgram();
    glAttachShader(program, vertex);
    glAttachShader(program, fragment);
    glLinkProgram(program);
    glDeleteShader(vertex);
    glDeleteShader(fragment);
    GLint linked = GL_FALSE;
    glGetProgramiv(program, GL_LINK_STATUS, &linked);
    if (linked != GL_TRUE) {
        std::array<char, 2048> log{};
        glGetProgramInfoLog(program, static_cast<GLsizei>(log.size()), nullptr, log.data());
        std::fprintf(stderr, "Three Linux program link failed: %s\n", log.data());
        glDeleteProgram(program);
        return 0;
    }
    return program;
}

Valdi::Ref<Valdi::StandaloneView> findMeshView(const Valdi::Ref<Valdi::StandaloneView>& view) {
    if (view == nullptr) return nullptr;
    if (view->getAttribute(STRING_LITERAL("meshBytes")).isTypedArray()) return view;
    for (const auto& child : view->getChildren()) {
        auto found = findMeshView(child);
        if (found != nullptr) return found;
    }
    return nullptr;
}

Valdi::Ref<Valdi::StandaloneView> findDragView(const Valdi::Ref<Valdi::StandaloneView>& view) {
    if (view == nullptr) return nullptr;
    if (view->getAttribute(STRING_LITERAL("onDrag")).isFunction()) return view;
    for (const auto& child : view->getChildren()) {
        auto found = findDragView(child);
        if (found != nullptr) return found;
    }
    return nullptr;
}

void dispatchDrag(const Valdi::Ref<Valdi::StandaloneView>& rootView,
                  Valdi::TouchEventState state,
                  double x,
                  double y,
                  double deltaX,
                  double deltaY) {
    auto dragView = findDragView(rootView);
    if (dragView == nullptr) return;
    auto callback = dragView->getAttribute(STRING_LITERAL("onDrag")).getFunctionRef();
    if (callback == nullptr) return;
    Valdi::TouchEvents::PointerLocations pointerLocations;
    const int pointerCount = state == Valdi::TouchEventStateEnded ? 0 : 1;
    if (pointerCount != 0) pointerLocations.emplace_back(x, y, 0);
    auto event = Valdi::TouchEvents::makeDragEvent(
        state, x, y, x, y, deltaX, deltaY, 0, 0, pointerCount, pointerLocations);
    auto result = (*callback)({std::move(event)});
    if (!result) std::fprintf(stderr, "Valdi drag callback failed: %s\n", result.error().toString().c_str());
}

int frameLimitFromArguments(int argc, const char** argv) {
    for (int i = 1; i < argc; ++i) {
        if (std::strncmp(argv[i], "--frames=", 9) != 0) continue;
        char* end = nullptr;
        const long value = std::strtol(argv[i] + 9, &end, 10);
        if (end != argv[i] + 9 && *end == '\0' && value > 0 && value <= std::numeric_limits<int>::max()) {
            return static_cast<int>(value);
        }
    }
    return 0;
}

bool hasArgument(int argc, const char** argv, const char* name) {
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], name) == 0) return true;
    }
    return false;
}

void enqueueDragTest(SDL_Window* window) {
    const Uint32 windowId = SDL_GetWindowID(window);
    SDL_Event event{};
    event.type = SDL_MOUSEBUTTONDOWN;
    event.button.windowID = windowId;
    event.button.button = SDL_BUTTON_LEFT;
    event.button.x = 300;
    event.button.y = 400;
    SDL_PushEvent(&event);

    event = SDL_Event{};
    event.type = SDL_MOUSEMOTION;
    event.motion.windowID = windowId;
    event.motion.state = SDL_BUTTON_LMASK;
    event.motion.x = 420;
    event.motion.y = 400;
    SDL_PushEvent(&event);

    event = SDL_Event{};
    event.type = SDL_MOUSEBUTTONUP;
    event.button.windowID = windowId;
    event.button.button = SDL_BUTTON_LEFT;
    event.button.x = 420;
    event.button.y = 400;
    SDL_PushEvent(&event);
}

int captureFrameFromEnvironment() {
    const char* value = std::getenv("THREE_NATIVE_LINUX_CAPTURE_FRAME");
    if (value == nullptr) return 20;
    char* end = nullptr;
    const long frame = std::strtol(value, &end, 10);
    if (end == value || *end != '\0' || frame < 1 || frame > std::numeric_limits<int>::max()) return 20;
    return static_cast<int>(frame);
}

bool capturePPM(const char* path, int width, int height) {
    if (path == nullptr || width <= 0 || height <= 0) return false;
    std::vector<unsigned char> rgba(static_cast<size_t>(width) * height * 4);
    glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, rgba.data());
    if (glGetError() != GL_NO_ERROR) return false;

    std::vector<unsigned char> rgb(static_cast<size_t>(width) * height * 3);
    std::unordered_set<unsigned int> distinctColors;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const size_t source = (static_cast<size_t>(height - 1 - y) * width + x) * 4;
            const size_t target = (static_cast<size_t>(y) * width + x) * 3;
            const unsigned int color = (static_cast<unsigned int>(rgba[source]) << 16) |
                                       (static_cast<unsigned int>(rgba[source + 1]) << 8) | rgba[source + 2];
            distinctColors.insert(color);
            rgb[target] = rgba[source];
            rgb[target + 1] = rgba[source + 1];
            rgb[target + 2] = rgba[source + 2];
        }
    }

    FILE* file = std::fopen(path, "wb");
    if (file == nullptr) return false;
    std::fprintf(file, "P6\n%d %d\n255\n", width, height);
    const bool written = std::fwrite(rgb.data(), 1, rgb.size(), file) == rgb.size();
    const bool closed = std::fclose(file) == 0;
    if (written && closed) {
        std::printf("Captured %s (%zu distinct RGB colors)\n", path, distinctColors.size());
    }
    return written && closed;
}

class PlatterRenderer {
public:
    bool initialize() {
        _program = createProgram();
        if (_program == 0) return false;
        _mvpLocation = glGetUniformLocation(_program, "uMvp");
        _modelLocation = glGetUniformLocation(_program, "uModel");
        glGenVertexArrays(1, &_vertexArray);
        glGenBuffers(1, &_vertexBuffer);
        glBindVertexArray(_vertexArray);
        glBindBuffer(GL_ARRAY_BUFFER, _vertexBuffer);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, kFloatsPerVertex * sizeof(float), nullptr);
        glEnableVertexAttribArray(1);
        glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, kFloatsPerVertex * sizeof(float),
                              reinterpret_cast<void*>(3 * sizeof(float)));
        glEnable(GL_DEPTH_TEST);
        glClearColor(0.063f, 0.094f, 0.153f, 1.0f);
        return glGetError() == GL_NO_ERROR;
    }

    void dispose() {
        if (_vertexBuffer != 0) glDeleteBuffers(1, &_vertexBuffer);
        if (_vertexArray != 0) glDeleteVertexArrays(1, &_vertexArray);
        if (_program != 0) glDeleteProgram(_program);
    }

    size_t meshUploads() const { return _meshUploads; }
    size_t transformChanges() const { return _transformChanges; }
    float modelElement0() const { return _matrices[16]; }

    bool render(const Valdi::Ref<Valdi::StandaloneView>& rootView, int width, int height) {
        auto meshView = findMeshView(rootView);
        if (meshView != nullptr) {
            const auto* mesh = meshView->getAttribute(STRING_LITERAL("meshBytes")).getTypedArray();
            const auto* transform = meshView->getAttribute(STRING_LITERAL("transformBytes")).getTypedArray();
            if (mesh != nullptr && !mesh->getBuffer().isStrictlyIdenticalTo(_retainedMesh)) {
                const auto& bytes = mesh->getBuffer();
                if (bytes.size() % (kFloatsPerVertex * sizeof(float)) == 0 &&
                    bytes.size() / (kFloatsPerVertex * sizeof(float)) <= std::numeric_limits<GLsizei>::max()) {
                    glBindBuffer(GL_ARRAY_BUFFER, _vertexBuffer);
                    glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(bytes.size()), bytes.data(), GL_STATIC_DRAW);
                    _vertexCount = static_cast<GLsizei>(bytes.size() / (kFloatsPerVertex * sizeof(float)));
                    _retainedMesh = bytes;
                    ++_meshUploads;
                    if (!_announcedMesh) {
                        std::printf("Valdi mesh: %zu bytes, %d vertices; onDrag=%s\n", bytes.size(), _vertexCount,
                                    findDragView(rootView) != nullptr ? "yes" : "no");
                        std::fflush(stdout);
                        _announcedMesh = true;
                    }
                }
            }
            if (transform != nullptr && transform->getBuffer().size() == 32 * sizeof(float)) {
                if (!_hasTransform || std::memcmp(_matrices.data(), transform->getBuffer().data(), 32 * sizeof(float)) != 0) {
                    ++_transformChanges;
                }
                std::memcpy(_matrices.data(), transform->getBuffer().data(), 32 * sizeof(float));
                _hasTransform = true;
            }
        }

        glViewport(0, 0, width, height);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
        if (_vertexCount == 0 || !_hasTransform) return false;
        glUseProgram(_program);
        glUniformMatrix4fv(_mvpLocation, 1, GL_FALSE, _matrices.data());
        glUniformMatrix4fv(_modelLocation, 1, GL_FALSE, _matrices.data() + 16);
        glBindVertexArray(_vertexArray);
        glDrawArrays(GL_TRIANGLES, 0, _vertexCount);
        const GLenum error = glGetError();
        if (error != GL_NO_ERROR) {
            if (!_loggedRenderError) std::fprintf(stderr, "Three Linux GLES draw failed: 0x%x\n", error);
            _loggedRenderError = true;
            return false;
        }
        return true;
    }

private:
    GLuint _program = 0;
    GLuint _vertexArray = 0;
    GLuint _vertexBuffer = 0;
    GLint _mvpLocation = -1;
    GLint _modelLocation = -1;
    GLsizei _vertexCount = 0;
    Valdi::BytesView _retainedMesh;
    std::array<float, 32> _matrices{};
    bool _hasTransform = false;
    bool _announcedMesh = false;
    bool _loggedRenderError = false;
    size_t _meshUploads = 0;
    size_t _transformChanges = 0;
};

} // namespace

int main(int argc, const char** argv) {
    SDL_SetMainReady();
    if (SDL_Init(SDL_INIT_VIDEO) != 0) {
        std::fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);

    SDL_Window* window = SDL_CreateWindow("Valdi Three Native Linux",
                                          SDL_WINDOWPOS_CENTERED,
                                          SDL_WINDOWPOS_CENTERED,
                                          kInitialWidth,
                                          kInitialHeight,
                                          SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI);
    if (window == nullptr) {
        std::fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError());
        SDL_Quit();
        return 1;
    }
    SDL_GLContext glContext = SDL_GL_CreateContext(window);
    if (glContext == nullptr) {
        std::fprintf(stderr, "SDL_GL_CreateContext: %s\n", SDL_GetError());
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }
    SDL_GL_SetSwapInterval(0);
    std::printf("SDL %s, GLES %s, GPU %s\n", SDL_GetCurrentVideoDriver(),
                reinterpret_cast<const char*>(glGetString(GL_VERSION)),
                reinterpret_cast<const char*>(glGetString(GL_RENDERER)));
    std::fflush(stdout);

    PlatterRenderer renderer;
    if (!renderer.initialize()) {
        renderer.dispose();
        SDL_GL_DeleteContext(glContext);
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    auto component = ValdiLinux::createLinuxComponentRuntime(kComponentPath, kInitialWidth, kInitialHeight, argc, argv);
    auto mainQueue = component.runtime->getMainQueue();
    const int frameLimit = frameLimitFromArguments(argc, argv);
    const bool dragTest = hasArgument(argc, argv, "--drag-test");
    const char* capturePath = std::getenv("THREE_NATIVE_LINUX_CAPTURE");
    const int captureFrame = captureFrameFromEnvironment();
    int sceneFrames = 0;
    bool captureAttempted = false;
    bool captureSucceeded = false;
    bool dragging = false;
    int dragStartX = 0;
    int dragStartY = 0;
    bool dragTestInjected = false;
    float modelBeforeDrag = 0;

    while (!mainQueue->isDisposed()) {
        SDL_Event event;
        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_QUIT ||
                (event.type == SDL_WINDOWEVENT && event.window.event == SDL_WINDOWEVENT_CLOSE) ||
                (event.type == SDL_KEYDOWN && event.key.keysym.sym == SDLK_ESCAPE)) {
                mainQueue->exit(0);
            } else if (event.type == SDL_WINDOWEVENT &&
                       (event.window.event == SDL_WINDOWEVENT_SIZE_CHANGED ||
                        event.window.event == SDL_WINDOWEVENT_RESIZED) &&
                       event.window.data1 > 0 && event.window.data2 > 0) {
                component.rootViewTree->setLayoutSpecs(
                    Valdi::Size(event.window.data1, event.window.data2), Valdi::LayoutDirectionLTR);
            } else if (event.type == SDL_MOUSEBUTTONDOWN && event.button.button == SDL_BUTTON_LEFT) {
                dragging = true;
                dragStartX = event.button.x;
                dragStartY = event.button.y;
                dispatchDrag(Valdi::StandaloneView::unwrap(component.rootViewTree->getRootView()),
                             Valdi::TouchEventStateStarted, event.button.x, event.button.y, 0, 0);
            } else if (event.type == SDL_MOUSEMOTION && dragging) {
                dispatchDrag(Valdi::StandaloneView::unwrap(component.rootViewTree->getRootView()),
                             Valdi::TouchEventStateChanged, event.motion.x, event.motion.y,
                             event.motion.x - dragStartX, event.motion.y - dragStartY);
            } else if (event.type == SDL_MOUSEBUTTONUP && event.button.button == SDL_BUTTON_LEFT && dragging) {
                dragging = false;
                dispatchDrag(Valdi::StandaloneView::unwrap(component.rootViewTree->getRootView()),
                             Valdi::TouchEventStateEnded, event.button.x, event.button.y,
                             event.button.x - dragStartX, event.button.y - dragStartY);
            }
        }
        if (mainQueue->isDisposed()) break;
        mainQueue->runNextTask(std::chrono::steady_clock::now() + std::chrono::milliseconds(16));

        int drawableWidth = 0;
        int drawableHeight = 0;
        SDL_GL_GetDrawableSize(window, &drawableWidth, &drawableHeight);
        if (drawableWidth <= 0 || drawableHeight <= 0) continue;
        auto rootView = Valdi::StandaloneView::unwrap(component.rootViewTree->getRootView());
        if (renderer.render(rootView, drawableWidth, drawableHeight)) {
            ++sceneFrames;
            if (dragTest && !dragTestInjected && sceneFrames >= 20) {
                modelBeforeDrag = renderer.modelElement0();
                enqueueDragTest(window);
                dragTestInjected = true;
            }
            if (!captureAttempted && capturePath != nullptr && sceneFrames >= captureFrame) {
                captureAttempted = true;
                captureSucceeded = capturePPM(capturePath, drawableWidth, drawableHeight);
                if (!captureSucceeded) std::fprintf(stderr, "Failed to capture Linux platter frame\n");
            }
            if (frameLimit != 0 && sceneFrames >= frameLimit) mainQueue->exit(0);
        }
        SDL_GL_SwapWindow(window);
    }

    int exitCode = mainQueue->runIndefinitely();
    if (capturePath != nullptr && !captureSucceeded) exitCode = 1;
    std::printf("Rendered %d Valdi scene frames; %zu mesh uploads; %zu transform changes\n",
                sceneFrames, renderer.meshUploads(), renderer.transformChanges());
    if (dragTestInjected) {
        const float change = std::fabs(renderer.modelElement0() - modelBeforeDrag);
        std::printf("Drag test model change: %.3f\n", change);
        if (change < 0.2f) exitCode = 1;
    } else if (dragTest) {
        std::fprintf(stderr, "Drag test did not reach a rendered scene\n");
        exitCode = 1;
    }
    renderer.dispose();
    component.rootViewTree = nullptr;
    component.runtime = nullptr;
    SDL_GL_DeleteContext(glContext);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return exitCode;
}
