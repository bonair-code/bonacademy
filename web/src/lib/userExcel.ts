import * as XLSX from "xlsx";

export type Role = "ADMIN" | "MANAGER" | "INSTRUCTOR" | "USER" | "CUSTOMER";
export type Ref = { id: string; name: string };

const HEADERS = [
  "Full Name",
  "Email",
  "Role",
  "Department",
  "Authorisation Scopes",
  "Company",
  "Place of Birth",
  "Date of Birth",
  "Temporary Password",
];

const SHEET_USERS = "Users";
const SHEET_EXAMPLE = "Example";
const SHEET_LISTS = "Valid Values";
const SHEET_HELP = "How to use";

const ROLE_BY_LABEL: Record<string, Role> = {
  admin: "ADMIN",
  manager: "MANAGER",
  "birim yöneticisi": "MANAGER",
  instructor: "INSTRUCTOR",
  eğitmen: "INSTRUCTOR",
  employee: "USER",
  user: "USER",
  çalışan: "USER",
  customer: "CUSTOMER",
  müşteri: "CUSTOMER",
};

export type ParsedUser = {
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  jobTitleIds: string[];
  jobTitleNames: string[];
  /** Müşteri hesabının bağlı olduğu kurum; personelde boş. */
  company: string | null;
  birthPlace: string | null;
  birthDate: string | null; // YYYY-MM-DD
  password: string;
  /** Şifre boş bırakıldıysa üretildi — içe aktarma sonunda admin'e gösterilir. */
  generatedPassword: boolean;
};

export type RowError = { row: number; message: string };
export type ParseResult = { users: ParsedUser[]; errors: RowError[]; sheetName: string };

/** Boş şablon + geçerli departman/unvan listeleri. */
export function downloadUserTemplate(departments: Ref[], jobTitles: Ref[]) {
  const wb = XLSX.utils.book_new();

  const users = XLSX.utils.aoa_to_sheet([HEADERS]);
  users["!cols"] = [
    { wch: 26 },
    { wch: 30 },
    { wch: 12 },
    { wch: 28 },
    { wch: 34 },
    { wch: 18 },
    { wch: 14 },
    { wch: 20 },
  ];
  users["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, users, SHEET_USERS);

  const example = XLSX.utils.aoa_to_sheet([
    HEADERS,
    [
      "Birol TUNÇ",
      "btunc@bonair.com.tr",
      "Manager",
      departments[0]?.name ?? "Maintenance Department",
      jobTitles.slice(0, 2).map((j) => j.name).join(", ") ||
        "Certifying Staff, Mechanic Technician",
      "İstanbul",
      "1985-04-12",
      "Bonair2026!",
    ],
    [
      "Ayşe YILMAZ",
      "ayilmaz@bonair.com.tr",
      "Employee",
      departments[0]?.name ?? "Maintenance Department",
      jobTitles[0]?.name ?? "Technician",
      "Ankara",
      "1992-11-03",
      "",
    ],
  ]);
  example["!cols"] = users["!cols"];
  XLSX.utils.book_append_sheet(wb, example, SHEET_EXAMPLE);

  // Yazım hatası en sık buradan çıkıyor; geçerli değerleri şablona koy.
  const maxLen = Math.max(departments.length, jobTitles.length, 4);
  const lists: (string | undefined)[][] = [["Roles", "Departments", "Authorisation Scopes"]];
  const roles = ["Admin", "Manager", "Instructor", "Employee", "Customer"];
  for (let i = 0; i < maxLen; i++) {
    lists.push([roles[i] ?? "", departments[i]?.name ?? "", jobTitles[i]?.name ?? ""]);
  }
  const listSheet = XLSX.utils.aoa_to_sheet(lists);
  listSheet["!cols"] = [{ wch: 14 }, { wch: 32 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, listSheet, SHEET_LISTS);

  const help = XLSX.utils.aoa_to_sheet([
    ["How to use this template"],
    [""],
    [`1. Fill in the "${SHEET_USERS}" sheet — one person per row.`],
    ["2. Full Name and Email are required. Email must be unique."],
    [`3. Role, Department and Authorisation Scopes must match the "${SHEET_LISTS}" sheet exactly.`],
    ["4. Authorisation Scopes may hold SEVERAL values in one cell — separate them with a comma"],
    ["   or a semicolon. Example: Certifying Staff, Technician"],
    ["5. Date of Birth: use YYYY-MM-DD (or a real Excel date cell)."],
    ["6. Place of Birth and Date of Birth are printed on the training certificate."],
    ["7. Temporary Password may be left empty — one is generated and shown after import."],
    ["8. A password you type must be at least 6 characters."],
    [`9. The "${SHEET_EXAMPLE}" sheet is ignored on import — it is only a reference.`],
    [""],
    ["Upload the saved file from the same place you downloaded this template."],
  ]);
  help["!cols"] = [{ wch: 95 }];
  XLSX.utils.book_append_sheet(wb, help, SHEET_HELP);

  XLSX.writeFile(wb, "bonacademy-users-template.xlsx");
}

/** Excel'in tarih hücresi Date, metin hücresi string gelir; ikisini de kabul et. */
function toISODate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/); // 12.04.1985 · 12/04/1985
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const body = Array.from(bytes, (b) => b.toString(36)).join("");
  return `Bon${body}!9`;
}

export async function parseUserWorkbook(
  file: File,
  departments: Ref[],
  jobTitles: Ref[]
): Promise<ParseResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheetName =
    wb.SheetNames.find((n) => n === SHEET_USERS) ??
    wb.SheetNames.find((n) => n !== SHEET_EXAMPLE && n !== SHEET_HELP && n !== SHEET_LISTS) ??
    wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet)
    return { users: [], errors: [{ row: 0, message: "The file has no sheets." }], sheetName: "" };

  const deptByName = new Map(departments.map((d) => [d.name.toLocaleLowerCase("tr"), d.id]));
  const titleByName = new Map(jobTitles.map((j) => [j.name.toLocaleLowerCase("tr"), j.id]));

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const users: ParsedUser[] = [];
  const errors: RowError[] = [];
  const seenEmails = new Set<string>();

  rows.forEach((raw, i) => {
    const rowNo = i + 2; // başlık satırı 1
    const name = String(raw["Full Name"] ?? "").trim();
    const email = String(raw["Email"] ?? "").trim().toLowerCase();

    if (!name && !email) return; // boş satır — sessizce atla

    if (!name) return void errors.push({ row: rowNo, message: "Full Name is empty." });
    if (!email) return void errors.push({ row: rowNo, message: "Email is empty." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return void errors.push({ row: rowNo, message: `"${email}" is not a valid email.` });
    if (seenEmails.has(email))
      return void errors.push({ row: rowNo, message: `"${email}" appears twice in this file.` });
    seenEmails.add(email);

    const roleRaw = String(raw["Role"] ?? "").trim();
    const role = roleRaw ? ROLE_BY_LABEL[roleRaw.toLocaleLowerCase("tr")] : "USER";
    if (!role)
      return void errors.push({
        row: rowNo,
        message: `Role "${roleRaw}" is unknown — use Admin, Manager, Instructor, Employee or Customer.`,
      });

    const deptRaw = String(raw["Department"] ?? "").trim();
    let departmentId: string | null = null;
    if (deptRaw) {
      departmentId = deptByName.get(deptRaw.toLocaleLowerCase("tr")) ?? null;
      if (!departmentId)
        return void errors.push({
          row: rowNo,
          message: `Department "${deptRaw}" does not exist — check the Valid Values sheet.`,
        });
    }

    // Birden fazla unvan: virgül, noktalı virgül, dikey çizgi veya alt satır.
    // Türkçe Excel'de liste ayıracı çoğu kurulumda ";" olduğu için ikisi de kabul.
    const titlesRaw = String(raw["Authorisation Scopes"] ?? "").trim();
    const jobTitleIds: string[] = [];
    const seenTitles = new Set<string>();
    for (const t of titlesRaw.split(/[,;|\n]/).map((x) => x.trim()).filter(Boolean)) {
      const id = titleByName.get(t.toLocaleLowerCase("tr"));
      if (!id)
        return void errors.push({
          row: rowNo,
          message: `Job title "${t}" does not exist — check the Valid Values sheet.`,
        });
      if (seenTitles.has(id)) continue; // aynı unvan iki kez yazılmışsa yut
      seenTitles.add(id);
      jobTitleIds.push(id);
    }

    const birthRaw = raw["Date of Birth"];
    const birthDate = toISODate(birthRaw);
    if (birthRaw && !birthDate)
      return void errors.push({
        row: rowNo,
        message: `Date of Birth "${String(birthRaw)}" is not a date — use YYYY-MM-DD.`,
      });

    const pwRaw = String(raw["Temporary Password"] ?? "").trim();
    if (pwRaw && pwRaw.length < 6)
      return void errors.push({
        row: rowNo,
        message: "Temporary Password must be at least 6 characters.",
      });

    // Müşteri personel değil: departmanı ve yetki kapsamı taşımaz.
    const company = String(raw["Company"] ?? "").trim() || null;
    if (role !== "CUSTOMER" && company)
      return void errors.push({
        row: rowNo,
        message: "Company only applies to Customer rows — leave it empty for staff.",
      });

    users.push({
      name,
      email,
      role,
      company: role === "CUSTOMER" ? company : null,
      departmentId: role === "CUSTOMER" ? null : departmentId,
      jobTitleIds: role === "CUSTOMER" ? [] : jobTitleIds,
      jobTitleNames: jobTitleIds.map(
        (id) => jobTitles.find((j) => j.id === id)?.name ?? id
      ),
      birthPlace: String(raw["Place of Birth"] ?? "").trim() || null,
      birthDate,
      password: pwRaw || randomPassword(),
      generatedPassword: !pwRaw,
    });
  });

  return { users, errors, sheetName };
}
