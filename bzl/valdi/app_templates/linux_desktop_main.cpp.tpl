#include <SDL3/SDL_main.h>
#include "valdi/linux/Desktop/LinuxDesktopMain.hpp"
int main(int argc, const char** argv) {
    return ValdiLinux::valdiLinuxDesktopMain("@VALDI_ROOT_COMPONENT_PATH@", "@VALDI_TITLE@", argc, argv);
}
