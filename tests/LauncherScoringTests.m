#define TEAMS_REACTION_TESTING 1
#import "../TeamsReactionPOC.m"

// Distinct provider elements may share a hash, including a toolbar ancestor.
@interface CollidingElement : NSObject
@property(nonatomic, strong) NSArray *children;
@property(nonatomic, strong) AXNode *control;
@end
@implementation CollidingElement
- (NSUInteger)hash { return 7; }
@end

static AXNode *Button(NSString *title, NSString *identifier, NSInteger depth) {
    AXNode *node = [AXNode new];
    node.identifier = identifier;
    node.title = title;
    node.nodeDescription = @"";
    node.helpText = @"";
    node.customDescription = @"";
    node.value = @"";
    node.role = (__bridge NSString *)kAXButtonRole;
    node.actions = @[(__bridge NSString *)kAXPressAction];
    node.depth = depth;
    node.focusedWindow = YES;
    node.processName = @"Microsoft Teams";
    node.windowTitle = @"Echo | Microsoft Teams";
    return node;
}

static void Expect(BOOL condition, NSString *message, int *failures) {
    if (condition) return;
    fprintf(stderr, "FAIL: %s\n", message.UTF8String);
    *failures += 1;
}

static void ExpectState(NSArray<AXNode *> *elements,
                        NSString *key,
                        id expected,
                        NSString *message,
                        int *failures) {
    NSDictionary *state = StateSnapshot(@{@"applicationCount": @1, @"elements": elements});
    Expect([state[key] isEqual:expected], message, failures);
}

static AXNode *SelectedOption(NSString *title, NSString *identifier) {
    AXNode *option = Button(title, identifier, 12);
    option.selected = YES;
    return option;
}

static AXNode *HandLauncher(NSString *customDescription) {
    AXNode *launcher = Button(@"React", @"reaction-menu-button", 8);
    launcher.customDescription = customDescription;
    return launcher;
}

// Blur rules, including two quirks: a selected blur reports on with no meeting,
// and no-effect wins when both options are selected.
static void TestBlurSnapshotState(int *failures) {
    AXNode *mic = Button(@"Unmute mic", @"microphone-button", 10);
    AXNode *effects = Button(@"Video effects and settings", @"video-effects-button", 10);
    AXNode *secondEffects = Button(@"Video effects and settings", @"video-effects-button", 10);
    AXNode *blur = Button(@"Blur", @"background-effect-blur", 12);
    AXNode *selectedBlur = SelectedOption(@"Blur", @"background-effect-blur");
    AXNode *secondSelectedBlur = SelectedOption(@"Blur", @"background-effect-blur");
    AXNode *selectedNone = SelectedOption(@"None", @"background-effect-none");

    ExpectState(@[mic, selectedNone], @"backgroundBlur", @"off",
        @"a selected no-effect option must report blur off", failures);
    ExpectState(@[mic, effects], @"backgroundBlur", @"unknown",
        @"an effects launcher with nothing selected must report blur unknown", failures);
    ExpectState(@[mic, effects, secondEffects], @"backgroundBlur", @"unknown",
        @"ambiguous effects launchers during a meeting must report blur unknown", failures);
    ExpectState(@[effects], @"meetingActive", @NO,
        @"an effects launcher alone must not mark a meeting active", failures);
    ExpectState(@[effects], @"backgroundBlur", @"unavailable",
        @"an effects launcher alone must report blur unavailable", failures);
    ExpectState(@[blur], @"backgroundBlur", @"unavailable",
        @"an unselected blur option without a meeting must report blur unavailable", failures);
    ExpectState(@[selectedBlur], @"meetingActive", @NO,
        @"a blur option alone must not mark a meeting active", failures);
    ExpectState(@[selectedBlur], @"backgroundBlur", @"on",
        @"a selected blur option must report blur on even with no meeting", failures);
    ExpectState(@[mic, selectedBlur, selectedNone], @"backgroundBlur", @"off",
        @"no-effect must win when blur and no-effect are both selected", failures);
    ExpectState(@[mic, effects, selectedBlur, secondSelectedBlur], @"backgroundBlur", @"unknown",
        @"two selected blur options must report blur unknown", failures);
    ExpectState(@[mic, selectedBlur, secondSelectedBlur], @"backgroundBlur", @"unavailable",
        @"two selected blur options without a launcher or no-effect option must report "
        @"blur unavailable", failures);
}

// Hand fallback rules: an ambiguous hand never falls back to the launcher, and an
// ambiguous launcher marks a meeting active without supplying hand state.
static void TestHandSnapshotState(int *failures) {
    NSString *raised = @"React or raise your hand. Your hand is raised. Has context menu";
    AXNode *hand = Button(@"Lower your hand", @"hand-button", 10);
    AXNode *secondHand = Button(@"Lower your hand", @"hand-button", 10);
    NSArray *twoLaunchers = @[HandLauncher(raised), HandLauncher(raised)];

    ExpectState(@[hand, secondHand, HandLauncher(raised)], @"hand", @"unknown",
        @"an ambiguous hand control must not fall back to the launcher description", failures);
    ExpectState(twoLaunchers, @"meetingActive", @YES,
        @"an ambiguous React launcher must still mark a meeting active", failures);
    ExpectState(twoLaunchers, @"hand", @"unavailable",
        @"an ambiguous React launcher must not supply hand state", failures);
}

static void TestControlFamilyState(int *failures) {
    AXNode *mic = Button(@"Unmute mic", @"microphone-button", 10);
    AXNode *camera = Button(@"Turn camera on", @"camera-button", 10);
    AXNode *secondCamera = Button(@"Turn camera on", @"camera-button", 10);

    ExpectState(@[mic, camera, secondCamera], @"camera", @"unknown",
        @"an ambiguous camera control must report camera unknown", failures);
    ExpectState(@[camera], @"microphone", @"unavailable",
        @"a camera without a microphone must report microphone unavailable", failures);
    ExpectState(@[camera], @"camera", @"off",
        @"a camera alone must mark the meeting active and report its state", failures);
}

static void TestAXErrorDescription(int *failures) {
    Expect([AXErrorDescription(kAXErrorSuccess) isEqualToString:@"success"],
        @"AX success must keep its description", failures);
    NSString *disabled = @"Accessibility API disabled or permission missing";
    Expect([AXErrorDescription(kAXErrorAPIDisabled) isEqualToString:disabled],
        @"AX API disabled must keep its description", failures);
    Expect([AXErrorDescription((AXError)-1) isEqualToString:@"AX error -1"],
        @"unknown AX errors must fall back to the numeric description", failures);
}

// Live Teams effects panel (November 2026): options are AXMenuItems whose AXValue
// is 1 when chosen, and the label text inside each item is pressable too.
static void TestLiveEffectsPanel(int *failures) {
    AXNode *item = Button(@"Standard blur", @"", 18);
    PopulateNode(item, @{(__bridge NSString *)kAXRoleAttribute: (__bridge NSString *)kAXMenuItemRole, (__bridge NSString *)kAXTitleAttribute: @"Standard blur", (__bridge NSString *)kAXValueAttribute: @1});
    Expect(item.selected, @"a menu item with AXValue 1 must read as selected", failures);
    AXNode *none = Button(@"No background effect", @"", 17);
    PopulateNode(none, @{(__bridge NSString *)kAXRoleAttribute: (__bridge NSString *)kAXMenuItemRole, (__bridge NSString *)kAXTitleAttribute: @"No background effect", (__bridge NSString *)kAXValueAttribute: @0});
    Expect(!none.selected, @"a menu item with AXValue 0 must read as not selected", failures);
    AXNode *button = Button(@"Standard blur", @"", 18);
    PopulateNode(button, @{(__bridge NSString *)kAXRoleAttribute: (__bridge NSString *)kAXButtonRole, (__bridge NSString *)kAXTitleAttribute: @"Standard blur", (__bridge NSString *)kAXValueAttribute: @1});
    Expect(!button.selected, @"AXValue 1 marks selection only on menu items", failures);
    AXNode *text = Button(@"", @"", 19);
    text.role = (__bridge NSString *)kAXStaticTextRole;
    text.value = @"Standard blur";
    Expect(BlurOptionScore(text) == NSIntegerMin, @"pressable label text must not compete with its blur menu item", failures);
    AXNode *image = Button(@"Background effect Standard blur", @"", 19);
    image.role = (__bridge NSString *)kAXImageRole;
    Expect(BlurOptionScore(image) == NSIntegerMin && NoEffectOptionScore(image) == NSIntegerMin, @"effect thumbnails must not be pressed as options", failures);
    BOOL ambiguous = NO;
    AXNode *best = BestUniqueNode(@[item, text], ^NSInteger(AXNode *node) { return BlurOptionScore(node); }, &ambiguous);
    Expect(best == item && !ambiguous, @"blur must resolve to the menu item when its label text is pressable", failures);
    ExpectState(@[item, none], @"backgroundBlur", @"on", @"a chosen blur menu item must report blur on", failures);
    BOOL toggle = YES, enable = NO;
    Expect(ResolveBlurToggle(@{@"applicationCount": @1, @"elements": @[item, none]}, &toggle, &enable) && !toggle && !enable, @"toggle with blur on must turn blur off", failures);
    toggle = YES;
    Expect(!ResolveBlurToggle(@{@"applicationCount": @1, @"elements": @[]}, &toggle, &enable) && toggle, @"toggle must wait while the panel is closed", failures);
}

// Teams hides the toolbar behind its Share content dialogue, which must still read as a meeting.
static void TestShareDialogue(int *failures) {
    AXNode *dialogue = Button(@"Share content", @"", 12);
    dialogue.role = (__bridge NSString *)kAXGroupRole;
    dialogue.actions = @[];
    ExpectState(@[dialogue], @"meetingActive", @YES, @"an open Share content dialogue must read as an active meeting", failures);
    AXNode *described = Button(@"", @"", 12);
    described.role = (__bridge NSString *)kAXGroupRole;
    described.nodeDescription = @"Share content";
    ExpectState(@[described], @"meetingActive", @YES, @"a Share content dialogue labelled by its description must read as an active meeting", failures);
    AXNode *button = Button(@"Share content", @"", 12);
    ExpectState(@[button], @"meetingActive", @NO, @"a Share content button alone is not meeting evidence", failures);
    AXNode *other = Button(@"Share files", @"", 12);
    other.role = (__bridge NSString *)kAXGroupRole;
    ExpectState(@[other], @"meetingActive", @NO, @"another group must not read as a meeting", failures);
    ExpectState(@[], @"meetingActive", @NO, @"no elements must not read as a meeting", failures);
}

static AXNode *ShareButton(NSString *title, NSInteger depth, BOOL inToolbar, BOOL focused) {
    AXNode *node = Button(title, @"", depth);
    node.inToolbar = inToolbar;
    node.focusedWindow = focused;
    return node;
}

// Live Teams scan (10 Nov 2026): while sharing, the meeting toolbar button reads Stop
// sharing (title and description) and a floating Sharing control bar window has another.
static void TestScreenShare(int *failures) {
    AXNode *mic = Button(@"Mute mic", @"microphone-button", 10);
    AXNode *toolbarStop = ShareButton(@"Stop sharing", 16, YES, NO);
    toolbarStop.nodeDescription = @"Stop sharing";
    AXNode *barStop = ShareButton(@"Stop sharing", 15, NO, YES);
    barStop.windowTitle = @"Sharing control bar | Microsoft Teams";
    BOOL ambiguous = YES;
    AXNode *chosen = BestUniqueNode(@[barStop, toolbarStop], ^NSInteger(AXNode *node) { return ShareScore(node); }, &ambiguous);
    Expect(chosen == toolbarStop && !ambiguous, @"the toolbar Stop sharing must win over the focused control bar's", failures);
    ambiguous = YES;
    chosen = BestUniqueNode(@[ShareButton(@"Stop sharing", 15, NO, NO), toolbarStop], ^NSInteger(AXNode *node) { return ShareScore(node); }, &ambiguous);
    Expect(chosen == toolbarStop && !ambiguous, @"the toolbar Stop sharing must win when neither window is focused", failures);
    ExpectState(@[mic, barStop, toolbarStop], @"screenShare", @"on", @"Stop sharing in the toolbar must report sharing on", failures);
    ExpectState(@[barStop], @"meetingActive", @YES, @"a control bar Stop sharing alone must mark a meeting active", failures);
    ExpectState(@[barStop], @"screenShare", @"on", @"a control bar Stop sharing alone must report sharing on", failures);
    ExpectState(@[mic, ShareButton(@"Share", 16, YES, YES)], @"screenShare", @"off", @"Share in the toolbar must report sharing off", failures);
    ExpectState(@[ShareButton(@"Share", 16, YES, YES)], @"meetingActive", @NO, @"a toolbar Share alone is not meeting evidence", failures);
    ExpectState(@[mic, toolbarStop, ShareButton(@"Stop sharing", 16, YES, NO)], @"screenShare", @"unknown", @"two toolbar Stop sharing controls must report unknown", failures);
    ExpectState(@[mic], @"screenShare", @"unavailable", @"a meeting without a Share control must report unavailable", failures);
    ExpectState(@[ShareButton(@"Stop sharing", 15, NO, NO)], @"screenShare", @"on", @"Stop sharing is recognised outside a toolbar", failures);

    AXNode *menuShare = ShareButton(@"Share", 4, NO, NO);
    menuShare.role = (__bridge NSString *)kAXMenuItemRole;
    Expect(ShareScore(menuShare) == NSIntegerMin, @"the menu bar Share item must never be pressed", failures);
    menuShare.inToolbar = YES;
    Expect(ShareScore(menuShare) == NSIntegerMin, @"a Share menu item must be rejected even inside a toolbar", failures);
    ExpectState(@[mic, menuShare], @"screenShare", @"unavailable", @"a Share menu item is not the meeting Share control", failures);
    ExpectState(@[menuShare], @"meetingActive", @NO, @"a Share menu item is not meeting evidence", failures);
    Expect(ShareScore(ShareButton(@"Share", 12, NO, YES)) == NSIntegerMin, @"Share outside a toolbar must never be pressed", failures);
    Expect(ShareScore(ShareButton(@"Share Microsoft Whiteboard Start Whiteboard", 10, YES, YES)) == NSIntegerMin, @"Share Microsoft Whiteboard is not the Share control", failures);
    AXNode *showMenuOnly = ShareButton(@"Share", 16, YES, YES);
    showMenuOnly.actions = @[(__bridge NSString *)kAXShowMenuAction];
    Expect(ShareScore(showMenuOnly) == NSIntegerMin, @"the Share control needs an actual press action", failures);

    AXNode *dialogue = Button(@"Share content", @"", 8);
    dialogue.role = (__bridge NSString *)kAXGroupRole;
    dialogue.actions = @[(__bridge NSString *)kAXShowMenuAction];
    Expect(ShareScore(dialogue) == NSIntegerMin, @"the Share content dialogue must not be pressed as the Share control", failures);
    ExpectState(@[dialogue], @"screenShare", @"off", @"an open share picker must report sharing off", failures);
    ExpectState(@[], @"screenShare", @"unavailable", @"no meeting must report sharing unavailable", failures);
    NSArray *controls = StateControlNodes(@{@"applicationCount": @1, @"elements": @[mic, toolbarStop, barStop, dialogue, menuShare]});
    Expect(controls.count == 4 && ![controls containsObject:menuShare], @"persistent refresh must keep the Share controls and the share picker", failures);
    AXNode *bareDialogue = Button(@"Share content", @"", 8);
    bareDialogue.role = (__bridge NSString *)kAXGroupRole;
    bareDialogue.actions = @[];
    Expect([StateControlNodes(@{@"applicationCount": @1, @"elements": @[bareDialogue]}) containsObject:bareDialogue], @"persistent refresh must keep a Share content dialogue with no actions", failures);
    AXNode *bareRefreshed = Button(@"Share content", @"", 8);
    bareRefreshed.role = bareDialogue.role;
    bareRefreshed.actions = @[];
    Expect(RefreshedControlsMatch(@[bareDialogue], @[bareRefreshed]), @"an actionless Share content dialogue that is still open must not force rediscovery", failures);
    bareRefreshed.title = @"Something else";
    Expect(!RefreshedControlsMatch(@[bareDialogue], @[bareRefreshed]), @"an actionless node that stopped being the Share dialogue must force rediscovery", failures);
    bareRefreshed.actions = @[(__bridge NSString *)kAXShowMenuAction];
    Expect(!RefreshedControlsMatch(@[bareDialogue], @[bareRefreshed]), @"a pressable node that stopped being the Share dialogue must force rediscovery", failures);
    AXNode *refreshed = ShareButton(@"Share", 16, YES, NO);
    Expect(RefreshedControlsMatch(@[toolbarStop], @[refreshed]), @"the toolbar button changing from Stop sharing to Share must stay a Share control", failures);
}

static AXNode *Child(AXNode *parent, NSString *role, NSString *description) {
    AXNode *node = Button(@"", @"", parent ? parent.depth + 1 : 8);
    node.role = role;
    node.nodeDescription = description;
    node.parent = parent;
    return node;
}

// Live Teams scan (10 Nov 2026): leaving while sharing opens a dialogue group whose
// inner group holds the question text and whose own children are Stay and Leave.
static void TestLeaveDialogue(int *failures) {
    NSString *button = (__bridge NSString *)kAXButtonRole, *group = (__bridge NSString *)kAXGroupRole;
    AXNode *dialogue = Child(nil, group, @"");
    AXNode *inner = Child(dialogue, group, @"");
    AXNode *text = Child(inner, (__bridge NSString *)kAXStaticTextRole, @"");
    text.value = @"You’re currently sharing. Are you sure you want to leave?";
    AXNode *stay = Child(dialogue, button, @"Stay");
    AXNode *dialogueLeave = Child(dialogue, button, @"Leave");
    AXNode *toolbar = Child(nil, (__bridge NSString *)kAXToolbarRole, @"");
    AXNode *toolbarLeave = Child(toolbar, button, @"Leave");
    toolbarLeave.title = @"Leave"; toolbarLeave.inToolbar = YES;
    AXNode *otherStay = Child(toolbar, button, @"Stay");
    NSArray *open = @[toolbar, toolbarLeave, otherStay, dialogue, inner, text, stay, dialogueLeave];
    Expect(LeaveDialogButton(open, @"leave") == dialogueLeave, @"the dialogue's Leave must be chosen over the toolbar Leave", failures);
    Expect(LeaveDialogButton(open, @"stay") == stay, @"Stay must come from the dialogue, never another Stay button", failures);
    Expect(LeaveDialogButton(@[toolbar, toolbarLeave, otherStay], @"stay") == nil, @"without the dialogue no Stay is pressed", failures);
    Expect(LeaveDialogButton(@[toolbar, toolbarLeave], @"leave") == nil, @"without the dialogue Leave falls back to the toolbar scorer", failures);
    Expect(LeaveDialogButton(@[dialogue, inner, text, dialogueLeave, otherStay], @"stay") == nil, @"a dialogue without its own Stay must not match", failures);
    AXNode *otherText = Child(inner, (__bridge NSString *)kAXStaticTextRole, @"");
    otherText.value = @"Are you sure you want to leave?";
    Expect(LeaveDialogButton(@[dialogue, inner, otherText, stay, dialogueLeave], @"leave") == nil, @"the question must mention current sharing", failures);
    stay.actions = @[(__bridge NSString *)kAXShowMenuAction];
    Expect(LeaveDialogButton(open, @"stay") == nil, @"Stay needs an actual press action", failures);
}

int main(void) {
    @autoreleasepool {
        int failures = 0;

        TestBlurSnapshotState(&failures);
        TestHandSnapshotState(&failures);
        TestControlFamilyState(&failures);
        TestAXErrorDescription(&failures);
        TestLiveEffectsPanel(&failures);
        TestShareDialogue(&failures);
        TestScreenShare(&failures);
        TestLeaveDialogue(&failures);

        __block NSInteger reactionPresses = 0;
        __block NSInteger reacquisitions = 0;
        AXError recovered = PressReactionWithRecovery(^AXError {
            reactionPresses += 1;
            return reactionPresses == 1 ? kAXErrorInvalidUIElement : kAXErrorSuccess;
        }, ^AXError { reacquisitions += 1; return kAXErrorSuccess; }, ^BOOL { return YES; });
        Expect(recovered == kAXErrorSuccess && reactionPresses == 2 && reacquisitions == 1, @"a stale first reaction press must reacquire once and recover", &failures);
        reactionPresses = 0; reacquisitions = 0;
        AXError failedAgain = PressReactionWithRecovery(^AXError {
            reactionPresses += 1; return kAXErrorInvalidUIElement;
        }, ^AXError { reacquisitions += 1; return kAXErrorSuccess; }, ^BOOL { return YES; });
        Expect(failedAgain == kAXErrorInvalidUIElement && reactionPresses == 2 && reacquisitions == 1, @"reaction recovery must stop after one retry", &failures);
        reactionPresses = 0; reacquisitions = 0;
        AXError uncertain = PressReactionWithRecovery(^AXError {
            reactionPresses += 1; return kAXErrorCannotComplete;
        }, ^AXError { reacquisitions += 1; return kAXErrorSuccess; }, ^BOOL { return YES; });
        Expect(uncertain == kAXErrorCannotComplete && reactionPresses == 1 && reacquisitions == 0, @"an uncertain reaction result must not be replayed", &failures);
        reactionPresses = 0; reacquisitions = 0;
        PressReactionWithRecovery(^AXError { reactionPresses += 1; return kAXErrorSuccess; }, ^AXError {
            reacquisitions += 1; return kAXErrorSuccess;
        }, ^BOOL { return YES; });
        Expect(reactionPresses == 1 && reacquisitions == 0, @"successful reactions must take the direct path", &failures);
        reactionPresses = 0; reacquisitions = 0;
        PressReactionWithRecovery(^AXError { reactionPresses += 1; return kAXErrorInvalidUIElement; }, ^AXError {
            reacquisitions += 1; return kAXErrorSuccess;
        }, ^BOOL { return reactionPresses == 0; });
        Expect(reactionPresses == 1 && reacquisitions == 0, @"release or duration expiry must prevent reaction recovery", &failures);
        reactionPresses = 0; reacquisitions = 0;
        PressReactionWithRecovery(^AXError { reactionPresses += 1; return kAXErrorInvalidUIElement; }, ^AXError {
            reacquisitions += 1; return kAXErrorSuccess;
        }, ^BOOL { return reacquisitions == 0; });
        Expect(reactionPresses == 1 && reacquisitions == 1, @"release during discovery must prevent the recovered press", &failures);

        NSDictionary *loveReaction = ReactionDefinitions()[@"love"];
        AXNode *existingLove = Button(@"Love", @"", 22);
        existingLove.role = (__bridge NSString *)kAXGroupRole;
        Expect(ReactionScore(existingLove, loveReaction) == NSIntegerMin, @"existing reaction content must not end picker discovery before its buttons appear", &failures);
        AXNode *outsideLove = Button(@"Love", @"", 13);
        Expect(ReactionScore(outsideLove, loveReaction) == NSIntegerMin, @"a reaction button outside a confirmed meeting picker must be rejected", &failures);
        for (NSString *key in ReactionDefinitions()) {
            NSDictionary *definition = ReactionDefinitions()[key];
            AXNode *choice = Button(definition[@"labels"][0], @"", 13);
            choice.meetingReactionPicker = YES;
            Expect(ReactionScore(choice, definition) > 0, @"each exact picker reaction button must remain eligible", &failures);
            choice.actions = @[(__bridge NSString *)kAXShowMenuAction];
            Expect(ReactionScore(choice, definition) == NSIntegerMin, @"reaction selection requires an actual press action", &failures);
        }
        AXNode *pickerContainer = Button(@"Love", @"", 12);
        pickerContainer.meetingReactionPicker = YES;
        pickerContainer.role = (__bridge NSString *)kAXGroupRole;
        Expect(ReactionScore(pickerContainer, loveReaction) == NSIntegerMin, @"picker containers must not masquerade as reaction buttons", &failures);
        AXNode *reactionDescription = Button(@"Someone sent Love", @"love-content", 10);
        reactionDescription.meetingReactionPicker = YES;
        Expect(ReactionScore(reactionDescription, loveReaction) == NSIntegerMin, @"reaction words in content must not match a picker action", &failures);

        __block NSInteger dismissals = 0;
        DismissPickerUntilGone(^{ dismissals += 1; }, ^BOOL { return dismissals < 2; });
        Expect(dismissals == 2, @"picker cleanup must retry an ignored Escape and stop once dismissed", &failures);
        dismissals = 0;
        DismissPickerUntilGone(^{ dismissals += 1; }, ^BOOL { return YES; });
        Expect(dismissals == 3, @"picker cleanup retries must remain bounded", &failures);
        dismissals = 0;
        DismissPickerUntilGone(^{ dismissals += 1; }, ^BOOL { return NO; });
        Expect(dismissals == 1, @"confirmed picker dismissal must not send another Escape", &failures);

        CollidingElement *root = [CollidingElement new];
        CollidingElement *content = [CollidingElement new];
        CollidingElement *toolbar = [CollidingElement new];
        CollidingElement *micElement = [CollidingElement new];
        CollidingElement *cameraElement = [CollidingElement new];
        CollidingElement *reactElement = [CollidingElement new];
        root.children = @[content, toolbar];
        toolbar.children = @[micElement, cameraElement, reactElement, root];
        micElement.control = Button(@"Unmute mic", @"microphone-button", 3);
        cameraElement.control = Button(@"Turn camera off", @"camera-button", 3);
        reactElement.control = Button(@"React", @"reaction-menu-button", 3);
        NSMutableArray *discovered = [NSMutableArray array];
        __block NSInteger visits = 0;
        WalkElements(root, ^NSArray *(id element, NSInteger depth) {
            (void)depth;
            visits += 1;
            CollidingElement *item = element;
            if (item.control) [discovered addObject:item.control];
            return item.children ?: @[];
        });
        Expect(visits == 6, @"traversal must visit distinct colliding elements once and stop real cycles", &failures);
        NSDictionary *collisionState = StateSnapshot(@{@"elements": discovered});
        Expect([collisionState[@"microphone"] isEqualToString:@"muted"] && [collisionState[@"camera"] isEqualToString:@"on"], @"hash collisions must not hide meeting controls behind a toolbar branch", &failures);
        Expect(BestNode(discovered, ^NSInteger(AXNode *node) { return LauncherScore(node); }) == reactElement.control, @"React must remain discoverable after colliding content elements", &failures);
        toolbar.children = @[];

        NSMutableArray<AXNode *> *busyWindow = [NSMutableArray array];
        for (NSInteger index = 0; index < 1000; index += 1) {
            AXNode *node = Button(@"Unrelated meeting content", @"unrelated-content", 12);
            if (index % 5 != 0) node.actions = @[];
            [busyWindow addObject:node];
        }
        [busyWindow addObject:Button(@"Unmute mic", @"microphone-button", 10)];
        [busyWindow addObject:Button(@"Turn camera off", @"camera-button", 10)];
        NSTimeInterval snapshotStart = NSProcessInfo.processInfo.systemUptime;
        MarkMeetingReactionPicker(busyWindow);
        NSDictionary *busyState = StateSnapshot(@{@"elements": busyWindow});
        NSTimeInterval snapshotElapsed = NSProcessInfo.processInfo.systemUptime - snapshotStart;
        Expect([busyState[@"microphone"] isEqualToString:@"muted"] && [busyState[@"camera"] isEqualToString:@"on"], @"large meeting scans must preserve exact control state", &failures);
        Expect(snapshotElapsed < 0.25, [NSString stringWithFormat:@"parsing a 1000-node meeting must stay below 250ms (was %.0fms)", snapshotElapsed * 1000], &failures);

        AXError missingAttribute = kAXErrorAttributeUnsupported;
        id missingValue = CFBridgingRelease(AXValueCreate(kAXValueAXErrorType, &missingAttribute));
        NSDictionary *attributes = AttributeDictionary(@[@"AXRole", @"AXIdentifier", @"AXDOMIdentifier", @"AXHelp", @"AXSelected"],
            @[@"AXButton", missingValue, @"microphone-button", NSNull.null, @YES]);
        AXNode *batchedNode = Button(@"", @"", 10);
        PopulateNode(batchedNode, attributes);
        Expect([batchedNode.identifier isEqualToString:@"microphone-button"], @"batched unsupported identifier must use the DOM identifier", &failures);
        Expect(batchedNode.selected && batchedNode.helpText.length == 0, @"batched errors and missing attributes must preserve safe defaults", &failures);

        AXNode *originalMic = Button(@"Unmute mic", @"microphone-button", 10);
        AXNode *originalCamera = Button(@"Turn camera off", @"camera-button", 10);
        NSDictionary *originalScan = @{@"applicationCount": @1, @"elements": @[originalMic, originalCamera, busyWindow[1]]};
        NSArray *stateControls = StateControlNodes(originalScan);
        __block NSInteger refreshedCount = 0;
        NSDictionary *refreshed = RefreshControlScan(originalScan, stateControls, ^AXNode *(AXNode *node) {
            refreshedCount += 1;
            return Button(node == originalMic ? @"Mute mic" : @"Turn camera off", node.identifier, node.depth);
        });
        Expect(refreshedCount == 2, @"verification must read state controls without walking unrelated meeting content", &failures);
        Expect([StateSnapshot(refreshed)[@"microphone"] isEqualToString:@"unmuted"], @"verification must use fresh microphone labels", &failures);
        Expect([StateSnapshot(refreshed)[@"camera"] isEqualToString:@"on"], @"verification must also refresh other state controls", &failures);
        Expect([StateSnapshot(originalScan)[@"microphone"] isEqualToString:@"muted"], @"verification must not overwrite the original snapshot", &failures);
        NSDictionary *disappeared = RefreshControlScan(originalScan, stateControls, ^AXNode *(AXNode *node) {
            return Button(@"", @"", node.depth);
        });
        Expect([StateSnapshot(disappeared)[@"microphone"] isEqualToString:@"unavailable"], @"replaced controls must not confirm cached state", &failures);
        NSDictionary *ambiguousScan = @{@"applicationCount": @1, @"elements": @[originalMic, Button(@"Unmute mic", @"other-microphone-button", 10)]};
        NSDictionary *ambiguousRefresh = RefreshControlScan(ambiguousScan, StateControlNodes(ambiguousScan), ^AXNode *(AXNode *node) {
            return Button(@"Mute mic", node.identifier, node.depth);
        });
        Expect([StateSnapshot(ambiguousRefresh)[@"microphone"] isEqualToString:@"unknown"], @"verification must retain every ambiguous candidate", &failures);

        Expect(ValidPersistentRequest(@{@"id": @1, @"command": @"mute", @"generation": @0, @"forceFresh": @YES}), @"persistent explicit mute request must validate", &failures);
        for (NSString *blocked in @[@"leave", @"hand-raise", @"burst", @"react", @"inspect", @"toggle", @"MUTE"]) {
            Expect(!ValidPersistentRequest(@{@"id": @1, @"command": blocked}), @"persistent protocol must reject commands outside its allow-list", &failures);
        }
        for (id badID in @[@YES, @0, @(-1), @1.5, @"1", NSNull.null]) {
            Expect(!ValidPersistentRequest(@{@"id": badID, @"command": @"status"}), @"persistent correlation IDs must be positive safe integers", &failures);
        }
        Expect(!ValidPersistentRequest(@{@"id": @1, @"command": @"mute", @"forceFresh": @"true"}), @"cache invalidation must require a boolean", &failures);
        Expect(!ValidPersistentGeneration(@{@"unexpected": @1}) && !ValidPersistentGeneration(@YES), @"generation tokens must reject non-integers and booleans", &failures);
        NSDictionary *unavailableState = @{@"microphone": @"unavailable", @"camera": @"unavailable"};
        Expect(PersistentNeedsDiscovery(YES, unavailableState, 0), @"a foreground request must rediscover an empty cache", &failures);
        Expect(!PersistentNeedsDiscovery(NO, unavailableState, 0), @"idle fallback must not repeatedly scan an empty meeting tree", &failures);
        Expect(!PersistentNeedsDiscovery(YES, @{@"microphone": @"muted", @"camera": @"on"}, 2), @"available warm controls must avoid full discovery", &failures);
        AXNode *cachedMic = Button(@"Unmute mic", @"microphone-button", 10);
        AXNode *freshMic = Button(@"Mute mic", @"microphone-button", 10);
        Expect(RefreshedControlsMatch(@[cachedMic], @[freshMic]), @"cached controls must accept a fresh state change", &failures);
        freshMic.identifier = @"replacement-button";
        Expect(!RefreshedControlsMatch(@[cachedMic], @[freshMic]), @"changed control identities must trigger rediscovery", &failures);
        freshMic.identifier = cachedMic.identifier; freshMic.title = @"Unrelated";
        Expect(!RefreshedControlsMatch(@[cachedMic], @[freshMic]), @"changed control meaning must trigger rediscovery", &failures);
        freshMic.title = @"Mute mic"; freshMic.actions = @[];
        Expect(!RefreshedControlsMatch(@[cachedMic], @[freshMic]), @"disappeared actions must trigger rediscovery", &failures);
        Expect(!RefreshedControlsMatch(@[cachedMic], @[]), @"missing cached controls must trigger rediscovery", &failures);

        AXNode *raiseHand = Button(@"Raise your hand", @"", 10);
        AXNode *react = Button(@"React", @"", 10);
        AXNode *selected = BestNode(@[raiseHand, react], ^NSInteger(AXNode *node) {
            return LauncherScore(node);
        });

        if (selected != react) {
            fprintf(stderr,
                "FAIL: expected React, selected %s (Raise=%ld, React=%ld)\n",
                selected.displayText.UTF8String,
                (long)LauncherScore(raiseHand),
                (long)LauncherScore(react));
            failures += 1;
        }

        AXNode *recentItem = Button(@"Notes about reactions", @"_recentItemRequested:", 7);
        recentItem.role = (__bridge NSString *)kAXMenuItemRole;
        AXNode *anotherRecentItem = Button(@"Reaction planning", @"_recentItemRequested:", 7);
        anotherRecentItem.role = (__bridge NSString *)kAXMenuItemRole;
        Expect(LauncherScore(recentItem) == NSIntegerMin && LauncherScore(anotherRecentItem) == NSIntegerMin, @"recent-item menu entries must never be meeting React launchers", &failures);
        NSDictionary *recentOnly = @{@"applicationCount": @1, @"elements": @[recentItem, anotherRecentItem]};
        Expect(![StateSnapshot(recentOnly)[@"meetingActive"] boolValue], @"recent-item text must not invent an active meeting", &failures);
        AXNode *exactMenuItem = Button(@"React", @"_recentItemRequested:", 7);
        exactMenuItem.role = (__bridge NSString *)kAXMenuItemRole;
        Expect(LauncherScore(exactMenuItem) == NSIntegerMin, @"a menu entry named React is still not a meeting toolbar control", &failures);

        AXNode *chatReact = Button(@"React to this message", @"", 7);
        selected = BestNode(@[chatReact, react], ^NSInteger(AXNode *node) {
            return LauncherScore(node);
        });
        if (selected != react) {
            fprintf(stderr,
                "FAIL: expected meeting React, selected %s (Chat=%ld, Meeting=%ld)\n",
                selected.displayText.UTF8String,
                (long)LauncherScore(chatReact),
                (long)LauncherScore(react));
            failures += 1;
        }

        AXNode *mute = Button(@"Mute", @"microphone-button", 10);
        AXNode *chatMute = Button(@"Mute", @"chat-microphone-button", 7);
        selected = BestNode(@[chatMute, mute], ^NSInteger(AXNode *node) { return MicrophoneScore(node); });
        Expect(selected == mute, @"microphone scorer must reject a chat control", &failures);
        Expect([MicrophoneStateForNode(mute) isEqualToString:@"unmuted"], @"Mute action must mean the microphone is currently unmuted", &failures);

        AXNode *unmute = Button(@"Unmute", @"microphone-button", 10);
        Expect([MicrophoneStateForNode(unmute) isEqualToString:@"muted"], @"Unmute action must mean the microphone is currently muted", &failures);
        AXNode *muteMic = Button(@"Mute mic", @"", 20);
        AXNode *unmuteMic = Button(@"Unmute mic", @"", 20);
        Expect(MicrophoneScore(muteMic) > 0, @"live Mute mic label must be recognized", &failures);
        Expect([MicrophoneStateForNode(muteMic) isEqualToString:@"unmuted"], @"Mute mic must mean the microphone is currently unmuted", &failures);
        Expect(MicrophoneScore(unmuteMic) > 0, @"live Unmute mic label must be recognized", &failures);
        Expect([MicrophoneStateForNode(unmuteMic) isEqualToString:@"muted"], @"Unmute mic must mean the microphone is currently muted", &failures);
        AXNode *notificationMute = Button(@"Mute notification sounds", @"notification-mute", 8);
        Expect(MicrophoneScore(notificationMute) == NSIntegerMin, @"microphone scorer must require an exact action label", &failures);

        AXNode *cameraOn = Button(@"Turn camera on", @"camera-button", 10);
        AXNode *cameraOff = Button(@"Turn camera off", @"camera-button", 10);
        Expect([CameraStateForNode(cameraOn) isEqualToString:@"off"], @"Turn camera on must mean the camera is currently off", &failures);
        Expect([CameraStateForNode(cameraOff) isEqualToString:@"on"], @"Turn camera off must mean the camera is currently on", &failures);

        Expect([HandStateForNode(raiseHand) isEqualToString:@"lowered"], @"Raise hand must mean the hand is currently lowered", &failures);
        AXNode *lowerHand = Button(@"Lower your hand", @"hand-button", 10);
        Expect([HandStateForNode(lowerHand) isEqualToString:@"raised"], @"Lower hand must mean the hand is currently raised", &failures);

        AXNode *pickerRaise = Button(@"Raise", @"", 8);
        pickerRaise.customDescription = @"Raise your hand. Has context menu";
        AXCustomContent *description = [AXCustomContent customContentWithLabel:@"description" value:pickerRaise.customDescription];
        NSData *archive = [NSKeyedArchiver archivedDataWithRootObject:@[description] requiringSecureCoding:YES error:NULL];
        Expect([CustomDescription(archive) isEqualToString:pickerRaise.customDescription], @"Chromium custom description archive must decode securely", &failures);
        Expect([CustomDescription(@[description]) isEqualToString:pickerRaise.customDescription], @"native custom description array must decode", &failures);
        Expect(CustomDescription([@"invalid archive" dataUsingEncoding:NSUTF8StringEncoding]).length == 0, @"invalid custom content must be ignored", &failures);
        Expect(CustomDescription(@[@"unexpected"]).length == 0, @"unexpected custom content must be ignored", &failures);
        AXNode *pickerLike = Button(@"Like", @"", 8);
        AXNode *pickerLove = Button(@"Love", @"", 8);
        AXNode *pickerLaugh = Button(@"Laugh", @"", 8);
        NSArray *picker = @[pickerRaise, pickerLike, pickerLove, pickerLaugh];
        MarkMeetingReactionPicker(picker);
        Expect(HandScore(pickerRaise) > 0, @"new meeting picker Raise must be selectable", &failures);
        Expect([HandStateForNode(pickerRaise) isEqualToString:@"lowered"], @"picker Raise means hand lowered", &failures);
        Expect([StateSnapshot(@{@"applicationCount": @1, @"elements": picker})[@"meetingActive"] boolValue], @"open meeting picker must preserve meeting detection", &failures);
        // The visible title stays Raise even when the hand is raised.
        pickerRaise.customDescription = @"Lower your hand. Has context menu";
        Expect([HandStateForNode(pickerRaise) isEqualToString:@"raised"], @"custom Lower description must override the unchanged Raise title", &failures);
        AXNode *unknownRaise = Button(@"Raise", @"raisehands-button", 8);
        unknownRaise.meetingReactionPicker = YES;
        Expect([HandStateForNode(unknownRaise) isEqualToString:@"unknown"], @"short Raise alone must not invent a hand state", &failures);
        AXNode *unscopedRaise = Button(@"Raise", @"", 8);
        MarkMeetingReactionPicker(@[unscopedRaise]);
        Expect(HandScore(unscopedRaise) == NSIntegerMin, @"short Raise outside a meeting picker must be rejected", &failures);
        AXNode *chatRaise = Button(@"Raise", @"chat-raise", 8);
        MarkMeetingReactionPicker(@[chatRaise, pickerLike, pickerLove, pickerLaugh]);
        Expect(HandScore(chatRaise) == NSIntegerMin, @"chat Raise must be rejected", &failures);

        // Current Teams exposes only the five reaction buttons while the picker is open.
        NSArray *reactionOnly = @[Button(@"Like", @"", 14), Button(@"Love", @"", 14), Button(@"Applause", @"", 14),
            Button(@"Laugh", @"", 14), Button(@"Surprised", @"", 14)];
        MarkMeetingReactionPicker(reactionOnly);
        Expect(ReactionScore(reactionOnly[2], ReactionDefinitions()[@"applause"]) != NSIntegerMin,
            @"a picker exposing only the five reaction buttons must be recognised", &failures);
        Expect(ReactionScore(reactionOnly[4], ReactionDefinitions()[@"surprise"]) != NSIntegerMin,
            @"Surprised must match the surprise reaction", &failures);
        NSArray *fourReactions = @[Button(@"Like", @"", 14), Button(@"Heart", @"", 14), Button(@"Laugh", @"", 14),
            Button(@"Surprised", @"", 14)];
        MarkMeetingReactionPicker(fourReactions);
        Expect(ReactionScore(fourReactions[0], ReactionDefinitions()[@"like"]) == NSIntegerMin,
            @"four reactions without Raise, as in a chat reaction bar, must not be a picker", &failures);
        AXNode *groupApplause = Button(@"Applause", @"", 14);
        groupApplause.role = (__bridge NSString *)kAXGroupRole;
        NSArray *groupFive = @[Button(@"Like", @"", 14), Button(@"Love", @"", 14), groupApplause,
            Button(@"Laugh", @"", 14), Button(@"Surprised", @"", 14)];
        MarkMeetingReactionPicker(groupFive);
        Expect(ReactionScore(groupFive[0], ReactionDefinitions()[@"like"]) == NSIntegerMin,
            @"a reaction group that is not a button must not complete a picker", &failures);
        NSArray *chatFive = @[Button(@"Like", @"chat-message-reaction", 14), Button(@"Love", @"chat-message-reaction", 14),
            Button(@"Applause", @"chat-message-reaction", 14), Button(@"Laugh", @"chat-message-reaction", 14),
            Button(@"Surprised", @"chat-message-reaction", 14)];
        MarkMeetingReactionPicker(chatFive);
        Expect(![chatFive[0] meetingReactionPicker], @"five reactions in chat context must not mark a picker", &failures);
        Expect(PickerDismissTarget(reactionOnly, [reactionOnly[0] pid]) != nil,
            @"a picker without Raise must still give Escape a control to confirm dismissal", &failures);
        Expect(PickerDismissTarget(picker, pickerRaise.pid) == pickerRaise,
            @"a picker with Raise must confirm dismissal against Raise", &failures);

        AXNode *stateLauncher = Button(@"React", @"reaction-menu-button", 8);
        stateLauncher.customDescription = @"React or raise your hand. Your hand is not raised. Has context menu";
        NSDictionary *launcherScan = @{@"applicationCount": @1, @"elements": @[stateLauncher]};
        Expect([StateSnapshot(launcherScan)[@"hand"] isEqualToString:@"lowered"], @"closed picker must expose lowered state from React description", &failures);
        stateLauncher.customDescription = @"React or raise your hand. Your hand is raised. Has context menu";
        Expect([StateSnapshot(launcherScan)[@"hand"] isEqualToString:@"raised"], @"closed picker must expose raised state from React description", &failures);
        stateLauncher.customDescription = @"React or raise your hand. Has context menu";
        Expect([HandStateFromLauncher(stateLauncher) isEqualToString:@"unavailable"], @"generic React description must not invent hand state", &failures);

        MeetingToolbarScan = @{@"applicationCount": @1, @"elements": @[mute, cameraOn]};
        NSDictionary *pickerState = StateSnapshot(WithMeetingToolbarState(@{@"applicationCount": @1, @"elements": picker}));
        Expect([pickerState[@"hand"] isEqualToString:@"raised"] && [pickerState[@"microphone"] isEqualToString:@"unmuted"] && [pickerState[@"camera"] isEqualToString:@"off"], @"modal picker snapshot must preserve toolbar states and use the current hand state", &failures);
        NSDictionary *closedScan = @{@"applicationCount": @1, @"elements": @[unmute]};
        Expect(WithMeetingToolbarState(closedScan) == closedScan, @"closed picker must use fresh toolbar state", &failures);
        MeetingToolbarScan = nil;

        AXNode *leave = Button(@"Leave", @"leave-button", 10);
        AXNode *endForAll = Button(@"Leave | End meeting for all", @"end-meeting-button", 9);
        Expect(LeaveScore(leave) > 0, @"exact Leave control must be eligible", &failures);
        Expect(LeaveScore(endForAll) == NSIntegerMin, @"End meeting for all must never be eligible", &failures);

        AXNode *customEndForAll = Button(@"Leave", @"leave-button", 10);
        customEndForAll.customDescription = @"End meeting for all";
        Expect(LeaveScore(customEndForAll) == NSIntegerMin, @"destructive custom description must veto a Leave title", &failures);
        AXNode *newMic = Button(@"Mic", @"microphone-button", 10);
        newMic.customDescription = @"Unmute mic. Has context menu";
        newMic.role = (__bridge NSString *)kAXCheckBoxRole;
        Expect(MicrophoneScore(newMic) > 0 && [MicrophoneStateForNode(newMic) isEqualToString:@"muted"], @"generic Mic title must use custom action state", &failures);
        AXNode *newCamera = Button(@"Camera", @"video-button", 10);
        newCamera.customDescription = @"Turn camera off. Has context menu";
        Expect(CameraScore(newCamera) > 0 && [CameraStateForNode(newCamera) isEqualToString:@"on"], @"generic Camera title must use custom action state", &failures);

        BOOL ambiguous = NO;
        AXNode *secondLeave = Button(@"Leave", @"leave-button", 10);
        AXNode *unique = BestUniqueNode(@[leave, secondLeave], ^NSInteger(AXNode *node) { return LeaveScore(node); }, &ambiguous);
        Expect(unique == nil && ambiguous, @"equally plausible destructive controls must fail as ambiguous", &failures);

        AXNode *effects = Button(@"Video effects and settings", @"video-effects-button", 10);
        AXNode *blur = Button(@"Blur", @"background-effect-blur", 12);
        AXNode *none = Button(@"None", @"background-effect-none", 12);
        AXNode *videoOptions = Button(@"Open video options", @"", 20);
        AXNode *standardBlur = Button(@"Standard blur", @"", 17);
        AXNode *noBackground = Button(@"No background effect", @"", 16);
        blur.selected = YES;
        Expect(EffectsLauncherScore(effects) > 0, @"video effects launcher must be recognized", &failures);
        Expect(BlurOptionScore(blur) > 0 && NoEffectOptionScore(none) > 0, @"blur and no-effect choices need separate scorers", &failures);
        Expect(EffectsLauncherScore(videoOptions) > 0, @"live Open video options launcher must be recognized", &failures);
        Expect(BlurOptionScore(standardBlur) > 0, @"live Standard blur option must be recognized", &failures);
        Expect(NoEffectOptionScore(noBackground) > 0, @"live No background effect option must be recognized", &failures);

        AXNode *standardBlurMenuItem = Button(@"Standard blur", @"", 17);
        standardBlurMenuItem.role = (__bridge NSString *)kAXMenuItemRole;
        AXNode *standardBlurText = Button(@"Standard blur", @"", 18);
        standardBlurText.role = (__bridge NSString *)kAXStaticTextRole;
        standardBlurText.actions = @[(__bridge NSString *)kAXShowMenuAction];
        BOOL blurAmbiguous = NO;
        AXNode *uniqueBlur = BestUniqueNode(@[standardBlurMenuItem, standardBlurText], ^NSInteger(AXNode *node) { return BlurOptionScore(node); }, &blurAmbiguous);
        Expect(uniqueBlur == standardBlurMenuItem && !blurAmbiguous, @"blur scorer must select the pressable menu item over its text child", &failures);

        NSDictionary *snapshot = StateSnapshot(@{@"applicationCount": @1, @"elements": @[unmute, cameraOn, lowerHand, leave, react, effects, blur, none]});
        Expect([snapshot[@"meetingActive"] boolValue], @"known meeting controls must mark the meeting active", &failures);
        Expect([snapshot[@"microphone"] isEqualToString:@"muted"], @"snapshot must report microphone state", &failures);
        Expect([snapshot[@"camera"] isEqualToString:@"off"], @"snapshot must report camera state", &failures);
        Expect([snapshot[@"hand"] isEqualToString:@"raised"], @"snapshot must report hand state", &failures);
        Expect([snapshot[@"backgroundBlur"] isEqualToString:@"on"], @"selected blur option must report blur on", &failures);

        if (failures > 0) return 1;
        printf("PASS: selected safe meeting controls and derived their states\n");
        return 0;
    }
}
