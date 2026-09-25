#include "valdi/linux_sdl/LinuxSDLMain.hpp"

int main(int argc, const char** argv) {
    return ValdiLinux::valdiLinuxSDLMain("@VALDI_ROOT_COMPONENT_PATH@",
                                        @VALDI_WINDOW_WIDTH@,
                                        @VALDI_WINDOW_HEIGHT@,
                                        argc,
                                        argv);
}
