import fs from "fs";

const body = JSON.parse(fs.readFileSync("input.json", "utf-8"));

const run = async () => {
  const resp = await fetch("http://localhost:3000/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  fs.writeFileSync("output.json", JSON.stringify(data, null, 2));
  console.log("Saved response to output.json");
};
run();
