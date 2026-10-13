"""Explicit installed SDK headers for the experimental Linux desktop host."""

def _syslibs_impl(ctx):
    for directory, probe in [("SDL3", "SDL.h"), ("fontconfig", "fontconfig.h")]:
        source = ctx.path("/usr/include/" + directory)
        if not source.get_child(probe).exists:
            fail("Linux desktop needs SDL3 and Fontconfig development headers under /usr/include")
        ctx.symlink(source, "include/" + directory)
    ctx.file("BUILD.bazel", """cc_library(
    name = "syslibs",
    hdrs = glob(["include/**/*.h"]),
    includes = ["include"],
    linkopts = ["-lSDL3", "-lfontconfig"],
    visibility = ["//visibility:public"],
)
""")

_syslibs = repository_rule(implementation = _syslibs_impl, local = True)

def _extension_impl(_ctx):
    _syslibs(name = "valdi_linux_desktop_syslibs")

linux_desktop_deps = module_extension(implementation = _extension_impl)
