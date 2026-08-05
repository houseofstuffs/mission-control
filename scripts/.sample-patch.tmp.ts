/* temporarily give shot-1 a Sample Image so the region editor renders */
import Database from "better-sqlite3";
const db = new Database("./data/ui-preview.db");
const row = db.prepare("SELECT record_json FROM records WHERE page_id = ?").get("shot-1") as { record_json: string };
const rec = JSON.parse(row.record_json);
rec.props["Sample Image"] = [{ name: "sample.svg", url: "http://127.0.0.1:3131/assets/pattern-5.svg" }];
db.prepare("UPDATE records SET record_json = ? WHERE page_id = ?").run(JSON.stringify(rec), "shot-1");
console.log("shot-1 sample image set");
