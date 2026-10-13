#include <gtest/gtest.h>
#include "snap_drawing/cpp/Text/TextLayoutBuilder.hpp"
#include "snap_drawing/cpp/Text/FontManager.hpp"
#include "valdi_core/cpp/Utils/ConsoleLogger.hpp"
#include "TestFontUtils.hpp"

namespace snap::drawing {
class TextCaretTest : public testing::Test {
protected:
    Ref<FontManager> manager;
    Ref<Font> font;
    void SetUp() override {
        manager = Valdi::makeShared<FontManager>(Valdi::ConsoleLogger::getLogger());
        manager->load();
        font = loadTestFont(manager, "Caret test", FontStyle(FontWidthNormal, FontWeightNormal, FontSlantUpright), "NotoSans-Regular.ttf");
    }
    Ref<TextLayout> layout(const char* text, float width = 800) {
        TextLayoutBuilder builder(TextAlignLeft, TextOverflowClip, Size::make(width, 1000), 0, manager, false, 1);
        builder.append(text, font, TextLayoutLineHeight::multiple(1), 0, TextDecorationNone);
        return builder.build();
    }
};
TEST_F(TextCaretTest, PreservesSpacesAndCombiningClusterOffsets) {
    auto l = layout("é x "); // UTF-16: e+combining mark occupy one shaped cluster.
    auto start = l->caretAtUTF16(0), clusterEnd = l->caretAtUTF16(2), end = l->caretAtUTF16(5);
    ASSERT_TRUE(start); ASSERT_TRUE(clusterEnd); ASSERT_TRUE(end);
    EXPECT_GT(clusterEnd->x(), start->x());
    EXPECT_GT(end->x(), l->caretAtUTF16(4)->x());
    EXPECT_FLOAT_EQ(start->y(), end->y());
}
TEST_F(TextCaretTest, WrapsWithoutAddingACaretGlyph) {
    auto l = layout("aaaa aaaa", 45);
    auto a = l->caretAtUTF16(0), b = l->caretAtUTF16(9);
    ASSERT_TRUE(a); ASSERT_TRUE(b); EXPECT_GT(b->y(), a->y());
    auto before = l->getBounds(); (void)l->caretAtUTF16(4);
    EXPECT_EQ(l->getBounds(), before);
}
TEST_F(TextCaretTest, PlacesCaretOnTrailingEmptyLines) {
    auto l = layout("a\n\n");
    auto a = l->caretAtUTF16(1), b = l->caretAtUTF16(2), c = l->caretAtUTF16(3);
    ASSERT_TRUE(a); ASSERT_TRUE(b); ASSERT_TRUE(c);
    EXPECT_GT(b->y(), a->y()); EXPECT_GT(c->y(), b->y()); EXPECT_FLOAT_EQ(c->x(), 0);
}
TEST_F(TextCaretTest, RetainsUtf16OffsetsForSurrogatePairs) {
    auto emoji = loadTestFont(manager, "Caret emoji", FontStyle(FontWidthNormal, FontWeightNormal, FontSlantUpright), "NotoColorEmoji-Regular.ttf");
    TextLayoutBuilder builder(TextAlignLeft, TextOverflowClip, Size::make(800, 1000), 0, manager, false, 1);
    builder.append("😀😀", emoji, TextLayoutLineHeight::multiple(1), 0, TextDecorationNone);
    auto l = builder.build();
    ASSERT_TRUE(l->caretAtUTF16(0)); ASSERT_TRUE(l->caretAtUTF16(2)); ASSERT_TRUE(l->caretAtUTF16(4));
    EXPECT_GT(l->caretAtUTF16(4)->x(), l->caretAtUTF16(2)->x());
}
}

namespace snap::drawing {
TEST_F(TextCaretTest, HitTestingUsesWrappedShapedPositions) {
    auto l = layout("é aaaa aaaa", 45);
    for (size_t offset : {size_t(0), size_t(2), size_t(11)}) {
        auto rect = l->caretAtUTF16(offset); ASSERT_TRUE(rect);
        EXPECT_EQ(l->closestCaretUTF16(Point::make(rect->x(), rect->y() + rect->height() / 2)), offset);
    }
}
}

namespace snap::drawing {
TEST_F(TextCaretTest, RetainsSpacesDiscardedAtAWrap) {
    auto l = layout("a   bbbb", 45);
    for (size_t offset = 0; offset <= 8; ++offset) { EXPECT_TRUE(l->caretAtUTF16(offset)) << offset; }
    EXPECT_GT(l->caretAtUTF16(4)->y(), l->caretAtUTF16(2)->y());
}
}
