#pragma once
#include <cerrno>
#include <cstdio>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <string>

namespace ValdiLinux {
constexpr size_t kMaxDocumentBytes = 1024 * 1024;

// A host-selected private directory and a single fixed file, never a script-selected host path.
class LinuxDocumentStore {
public:
    explicit LinuxDocumentStore(const std::string& path) {
        if (!path.empty()) {
            if (mkdir(path.c_str(), 0700) != 0 && errno != EEXIST) { return; }
            _dir = open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            struct stat info {};
            if (_dir >= 0 && (fstat(_dir, &info) != 0 || info.st_uid != getuid() || (info.st_mode & 0077) != 0)) {
                close(_dir); _dir = -1;
            }
        }
    }
    ~LinuxDocumentStore() { if (_dir >= 0) { close(_dir); } }
    bool enabled() const { return _dir >= 0; }
    std::string read() const {
        if (_dir < 0) { return {}; }
        int fd = openat(_dir, "document.txt", O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC);
        if (fd < 0) { return {}; }
        struct stat info {};
        std::string result;
        if (fstat(fd, &info) == 0 && S_ISREG(info.st_mode) && info.st_size <= static_cast<off_t>(kMaxDocumentBytes)) {
            char buffer[4096];
            ssize_t count;
            while ((count = ::read(fd, buffer, sizeof(buffer))) > 0 && result.size() + count <= kMaxDocumentBytes) {
                result.append(buffer, count);
            }
        }
        close(fd);
        return result;
    }
    bool write(const std::string& value) {
        if (_dir < 0 || value.size() > kMaxDocumentBytes) { return false; }
        auto name = ".document-" + std::to_string(getpid()) + "-" + std::to_string(++_sequence);
        int fd = openat(_dir, name.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        if (fd < 0) { return false; }
        size_t offset = 0;
        while (offset < value.size()) {
            ssize_t count = ::write(fd, value.data() + offset, value.size() - offset);
            if (count < 0 && errno == EINTR) { continue; }
            if (count <= 0) { break; }
            offset += count;
        }
        bool ok = offset == value.size() && fsync(fd) == 0;
        if (close(fd) != 0) { ok = false; }
        if (ok) { ok = renameat(_dir, name.c_str(), _dir, "document.txt") == 0 && fsync(_dir) == 0; }
        if (!ok) { unlinkat(_dir, name.c_str(), 0); }
        return ok;
    }
private:
    int _dir = -1;
    unsigned _sequence = 0;
};

}
