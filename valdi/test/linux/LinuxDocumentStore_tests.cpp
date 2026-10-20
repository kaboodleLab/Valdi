#include "valdi/linux/Desktop/LinuxDocumentStore.hpp"
#include <gtest/gtest.h>
#include <filesystem>
#include <fstream>

namespace {
class LinuxDocumentStoreTest : public testing::Test {
protected:
    std::string directory;
    void SetUp() override {
        char path[] = "/tmp/valdi-document-XXXXXX";
        auto* result = mkdtemp(path);
        ASSERT_NE(result, nullptr);
        directory = result;
    }
    void TearDown() override { std::filesystem::remove_all(directory); }
};
TEST_F(LinuxDocumentStoreTest, DurableUnicodeAndBoundedWrites) {
    const std::string text = "Hello 👨‍👩‍👧‍👦 — مرحبا — 日本語";
    { ValdiLinux::LinuxDocumentStore store(directory); ASSERT_TRUE(store.enabled()); ASSERT_TRUE(store.write(text)); }
    ValdiLinux::LinuxDocumentStore reopened(directory);
    EXPECT_EQ(reopened.read(), text);
    EXPECT_FALSE(reopened.write(std::string(ValdiLinux::kMaxDocumentBytes + 1, 'x')));
    EXPECT_EQ(reopened.read(), text);
}
TEST_F(LinuxDocumentStoreTest, RejectsUntrustedDirectoryAndDoesNotFollowDocumentSymlinks) {
    chmod(directory.c_str(), 0755);
    EXPECT_FALSE(ValdiLinux::LinuxDocumentStore(directory).enabled());
    chmod(directory.c_str(), 0700);
    std::ofstream(directory + "/outside.txt") << "outside";
    ASSERT_EQ(symlink("outside.txt", (directory + "/document.txt").c_str()), 0);
    ValdiLinux::LinuxDocumentStore store(directory);
    EXPECT_TRUE(store.read().empty());
    ASSERT_TRUE(store.write("private"));
    EXPECT_EQ(store.read(), "private");
    std::string outside; std::ifstream(directory + "/outside.txt") >> outside;
    EXPECT_EQ(outside, "outside");
}
}
