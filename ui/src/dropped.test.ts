import { expect, test } from "vitest";
import { fromFiles } from "./dropped.ts";

/** A file as picked from a folder with webkitdirectory. */
function picked(relativePath: string): File {
  const file = new File(["x"], relativePath.split("/").at(-1)!);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

test("fromFiles keeps the place of files within a picked folder", () => {
  const items = fromFiles([
    new File(["x"], "plain.txt"),
    picked("Album/cover.jpg"),
    picked("Album/Disc 1/01.flac"),
    picked("Album/.DS_Store"),
    picked("Album/.git/config"),
  ]);
  expect(items.map((i) => [i.dir, i.file.name])).toEqual([
    ["", "plain.txt"],
    ["Album", "cover.jpg"],
    ["Album/Disc 1", "01.flac"],
  ]);
});
