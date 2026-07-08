// Direct test runner - runs locally
import { testRouter } from "./test-router";
import { createContext } from "./context";

async function run() {
  const ctx = await createContext({ req: {} as any, resHeaders: new Headers() });
  const caller = testRouter.createCaller(ctx);
  
  console.log("Starting E2E test...\n");
  const start = Date.now();
  
  try {
    const result = await caller.fullFlow({ materialQty: 100 });
    
    if (result.success) {
      console.log("=== ✅ ЦЕЛОСНИОТ ТЕК РАБОТИ ПРАВИЛНО! ===\n");
      result.log.forEach(line => console.log(line));
    } else {
      console.log("=== ❌ ТЕСТОТ НЕ УСПЕА ===\n");
      console.log("Error:", result.error);
    }
  } catch (err: any) {
    console.error("=== ❌ EXCEPTION ===");
    console.error(err.message);
    console.error(err.stack);
  }
  
  console.log(`\nDuration: ${Date.now() - start}ms`);
  process.exit(0);
}

run();
