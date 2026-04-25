import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const LOGIN_URL = "https://apluseducation.lk/login";
const PROFILE_URL = "https://apluseducation.lk/profile";
const OUTPUT_DIR = path.resolve("lesson-output");
const JSON_PATH = path.join(OUTPUT_DIR, "lessons.json");
const MD_PATH = path.join(OUTPUT_DIR, "lessons.md");
const PLAYWRIGHT_CACHE = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const COURSE_CARD_SELECTOR = "a.course-card";
const LESSON_TITLE_SELECTOR = ".course-card h4";

const username = process.env.APLUS_USERNAME;
const password = process.env.APLUS_PASSWORD;

if (!username || !password) {
  console.error("Missing credentials. Set APLUS_USERNAME and APLUS_PASSWORD first.");
  process.exit(1);
}

const cleanText = (value) => value.replace(/\s+/g, " ").trim();

const extractNumber = (value) => {
  const match = value.match(/(\d+)(?!.*\d)/);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
};

const splitTitle = (title) => {
  const match = title.match(/^(.*?)(\d+)\s*$/);
  if (!match) {
    return { base: title, order: Number.MAX_SAFE_INTEGER };
  }

  return {
    base: cleanText(match[1]),
    order: Number.parseInt(match[2], 10),
  };
};

const sortLessons = (lessons) =>
  lessons.sort((a, b) => {
    const aParts = splitTitle(a.title);
    const bParts = splitTitle(b.title);
    const baseCompare = aParts.base.localeCompare(bParts.base, "si");
    if (baseCompare !== 0) return baseCompare;
    if (aParts.order !== bParts.order) return aParts.order - bParts.order;
    return a.title.localeCompare(b.title, "si");
  });

const sortCourseGroups = (courses) =>
  courses.sort((a, b) => a.courseTitle.localeCompare(b.courseTitle, "si"));

const ensureOutputDir = async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
};

const resolveBrowserExecutable = () => {
  const candidates = [
    path.join(PLAYWRIGHT_CACHE, "chromium-1200", "chrome-win64", "chrome.exe"),
    path.join(PLAYWRIGHT_CACHE, "chromium-1217", "chrome-win64", "chrome.exe"),
    path.join(
      PLAYWRIGHT_CACHE,
      "chromium_headless_shell-1200",
      "chrome-headless-shell-win64",
      "chrome-headless-shell.exe",
    ),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  return candidates.find((candidate) => fsSync.existsSync(candidate));
};

const writeOutputs = async (lessons) => {
  await ensureOutputDir();

  await fs.writeFile(
    JSON_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: lessons.length,
        lessons,
      },
      null,
      2,
    ),
  );

  const markdown = [
    "# aPlus Academy Lessons",
    "",
    `Total lessons: ${lessons.length}`,
    "",
    ...lessons.map((lesson, index) => `${index + 1}. ${lesson.title}`),
    "",
  ].join("\n");

  await fs.writeFile(MD_PATH, markdown, "utf8");
};

const writeGroupedOutputs = async (courses) => {
  const allLessons = sortLessons(
    courses.flatMap((course) =>
      course.lessons.map((lesson) => ({
        title: lesson.title,
        courseTitle: course.courseTitle,
        courseUrl: course.courseUrl,
      })),
    ),
  );

  await ensureOutputDir();

  await fs.writeFile(
    JSON_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        courseCount: courses.length,
        lessonCount: allLessons.length,
        courses,
        allLessons,
      },
      null,
      2,
    ),
    "utf8",
  );

  const markdown = [
    "# aPlus Academy Lessons",
    "",
    `Courses: ${courses.length}`,
    `Lessons: ${allLessons.length}`,
    "",
    "## Course Summary",
    "",
    ...courses.map(
      (course, index) =>
        `${index + 1}. **${course.courseTitle}** (${course.lessons.length} lessons)`,
    ),
    "",
    "## Lessons By Course",
    "",
    ...courses.flatMap((course) => [
      `### ${course.courseTitle}`,
      "",
      ...course.lessons.map((lesson, index) => `${index + 1}. ${lesson.title}`),
      "",
    ]),
    "## Master Sorted List",
    "",
    ...allLessons.map(
      (lesson, index) => `${index + 1}. ${lesson.title}  |  ${lesson.courseTitle}`,
    ),
    "",
  ].join("\n");

  await fs.writeFile(MD_PATH, markdown, "utf8");
};

const findLoginForm = async (page) => {
  const candidates = [
    { user: 'input[type="tel"]', pass: 'input[type="password"]' },
    { user: 'input[name="mobile"]', pass: 'input[name="password"]' },
    { user: 'input[name="username"]', pass: 'input[name="password"]' },
    { user: 'input[name="phone"]', pass: 'input[name="password"]' },
    { user: 'input[placeholder*="Mobile" i]', pass: 'input[type="password"]' },
    { user: 'input[placeholder*="Phone" i]', pass: 'input[type="password"]' },
    { user: 'input[placeholder*="Username" i]', pass: 'input[type="password"]' },
  ];

  for (const candidate of candidates) {
    const userCount = await page.locator(candidate.user).count();
    const passCount = await page.locator(candidate.pass).count();
    if (userCount > 0 && passCount > 0) {
      return candidate;
    }
  }

  throw new Error("Could not find login fields on the page.");
};

const maybeDismissPopups = async (page) => {
  const buttons = [
    "button:has-text('Close')",
    "button:has-text('OK')",
    "button:has-text('Got it')",
    "button:has-text('Skip')",
  ];

  for (const selector of buttons) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click().catch(() => {});
    }
  }
};

const clickAllFilters = async (page) => {
  const filters = page.locator("button.filter-btn");
  const count = await filters.count();

  for (let i = 0; i < count; i += 1) {
    const button = filters.nth(i);
    const text = cleanText((await button.textContent()) ?? "");
    if (text !== "All") continue;
    await button.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
};

const autoScrollLessons = async (page) => {
  let previousCount = -1;
  let stablePasses = 0;

  for (let i = 0; i < 40; i += 1) {
    const currentCount = await page.locator(LESSON_TITLE_SELECTOR).count();
    if (currentCount === previousCount) {
      stablePasses += 1;
    } else {
      stablePasses = 0;
      previousCount = currentCount;
    }

    if (stablePasses >= 4) break;

    await page.mouse.wheel(0, 2600);
    await page.waitForTimeout(1200);
  }
};

const collectLessonTitles = async (page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
  await maybeDismissPopups(page);

  await clickAllFilters(page);
  await autoScrollLessons(page);

  const titles = await page.locator(LESSON_TITLE_SELECTOR).evaluateAll((elements) =>
    elements
      .map((element) => element.textContent ?? "")
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );

  const unique = [...new Set(titles)]
    .map(cleanText)
    .filter(Boolean)
    .map((title) => ({
      title,
      lastNumber: extractNumber(title),
    }));

  return sortLessons(unique);
};

const collectCourses = async (page) => {
  await page.goto(PROFILE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const courses = await page.locator(COURSE_CARD_SELECTOR).evaluateAll((elements) =>
    elements.map((element) => ({
      courseTitle:
        element.querySelector("h3,h4,h5")?.textContent?.replace(/\s+/g, " ").trim() ??
        element.textContent?.replace(/\s+/g, " ").trim() ??
        "Untitled Course",
      courseUrl: element.href,
    })),
  );

  const seen = new Set();
  return courses.filter((course) => {
    if (!course.courseUrl || seen.has(course.courseUrl)) return false;
    seen.add(course.courseUrl);
    return true;
  });
};

const printPrettyList = (courses) => {
  const allLessons = courses.flatMap((course) => course.lessons);
  const longestTitle = Math.max(
    ...courses.flatMap((course) => course.lessons.map((lesson) => lesson.title.length)),
    10,
  );
  const line = "─".repeat(Math.min(longestTitle + 8, 100));

  console.log("");
  console.log("aPlus Academy Lesson List");
  console.log(line);
  courses.forEach((course) => {
    console.log("");
    console.log(`${course.courseTitle} (${course.lessons.length})`);
    course.lessons.forEach((lesson, index) => {
      const num = String(index + 1).padStart(3, " ");
      console.log(`${num}. ${lesson.title}`);
    });
  });
  console.log("");
  console.log(line);
  console.log(`Courses: ${courses.length}`);
  console.log(`Lessons: ${allLessons.length}`);
  console.log(`Saved: ${JSON_PATH}`);
  console.log(`Saved: ${MD_PATH}`);
};

const main = async () => {
  const executablePath = resolveBrowserExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const selectors = await findLoginForm(page);
    await page.locator(selectors.user).first().fill(username);
    await page.locator(selectors.pass).first().fill(password);

    const submitButton = page
      .locator("button[type='submit'], button:has-text('Login'), button:has-text('Sign in')")
      .first();

    await Promise.all([
      page.waitForLoadState("networkidle"),
      submitButton.click(),
    ]);

    if (page.url().includes("/login")) {
      await page.goto(PROFILE_URL, { waitUntil: "networkidle" });
    }

    const courseLinks = await collectCourses(page);
    if (courseLinks.length === 0) {
      throw new Error("No enrolled courses were found on the profile page.");
    }

    const results = [];
    for (const course of courseLinks) {
      await page.goto(course.courseUrl, { waitUntil: "domcontentloaded" });
      const lessons = await collectLessonTitles(page);
      results.push({
        courseTitle: course.courseTitle,
        courseUrl: course.courseUrl,
        lessons,
      });
    }

    const sortedResults = sortCourseGroups(results);
    const totalLessons = sortedResults.reduce((sum, course) => sum + course.lessons.length, 0);
    if (totalLessons === 0) {
      throw new Error("No lesson titles were found. The selectors may need one more pass.");
    }

    await writeGroupedOutputs(sortedResults);
    printPrettyList(sortedResults);
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
