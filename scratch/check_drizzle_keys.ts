import { db } from "../src/db";
import { clientSubscriptions, clients } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function test() {
  const userId = "some-user-id"; // Doesn't matter if it returns nothing, we just want to see the keys
  const result = await db.select().from(clientSubscriptions)
    .innerJoin(clients, eq(clientSubscriptions.clientId, clients.id))
    .limit(1);
  
  console.log("Result keys:", result.length > 0 ? Object.keys(result[0]) : "No results");
  if (result.length > 0) {
    console.log("First result:", JSON.stringify(result[0], null, 2));
  }
  process.exit(0);
}

test();
