import { getConversationSummaries } from "./conversationRepository";

async function runConversationHistoryTest() {
  console.log("");
  console.log("==========================================");
  console.log("LOCAL AI CONVERSATION HISTORY TEST");
  console.log("==========================================");

  try {
    const summaries = await getConversationSummaries();

    console.log(
      `[PASS] Retrieved ${summaries.length} conversation summary(s).`,
    );

    for (const conversation of summaries) {
      console.log("");
      console.log("Conversation:");
      console.log("  ID:", conversation.id);
      console.log("  Title:", conversation.title);
      console.log("  Model:", conversation.model);
      console.log("  Messages:", conversation.messageCount);
    }

    console.log("");
    console.log("ALL CONVERSATION HISTORY TESTS PASSED");
  } catch (error) {
    console.error("");
    console.error("CONVERSATION HISTORY TEST FAILED");
    console.error(error);
  }
}

runConversationHistoryTest();