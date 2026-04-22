import { prisma } from "@/lib/db";
import type { Course } from "@prisma/client";

/**
 * Persist a snapshot of the given course's current state as a new revision
 * and bump `course.currentRevision`. Call this after any change that
 * affects what a learner would see: SCORM package replacement, title /
 * description / passing score change, or an explicit manual revision.
 *
 * Returns the newly created revision's number.
 */
export async function createCourseRevision(
  courseId: string,
  createdById: string,
  changeNote?: string
): Promise<number> {
  // Load the course state we want to snapshot *before* bumping the counter
  // so the snapshot reflects what's currently live on the course row.
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  const nextNumber = course.currentRevision + 1;

  await prisma.$transaction([
    prisma.courseRevision.create({
      data: {
        courseId,
        revisionNumber: nextNumber,
        title: course.title,
        description: course.description,
        scormPackagePath: course.scormPackagePath,
        scormEntryPoint: course.scormEntryPoint,
        scormVersion: course.scormVersion,
        passingScore: course.passingScore,
        changeNote: changeNote?.trim() || null,
        createdById,
      },
    }),
    prisma.course.update({
      where: { id: courseId },
      data: { currentRevision: nextNumber },
    }),
  ]);

  return nextNumber;
}

/**
 * Ensure the course has at least a v1 baseline revision. Used when a course
 * exists from before the revision system was introduced so its history does
 * not start empty once a change is made.
 */
export async function ensureBaselineRevision(
  course: Pick<
    Course,
    | "id"
    | "title"
    | "description"
    | "scormPackagePath"
    | "scormEntryPoint"
    | "scormVersion"
    | "passingScore"
    | "currentRevision"
  >,
  createdById: string
) {
  const existing = await prisma.courseRevision.count({ where: { courseId: course.id } });
  if (existing > 0) return;
  await prisma.courseRevision.create({
    data: {
      courseId: course.id,
      revisionNumber: course.currentRevision,
      title: course.title,
      description: course.description,
      scormPackagePath: course.scormPackagePath,
      scormEntryPoint: course.scormEntryPoint,
      scormVersion: course.scormVersion,
      passingScore: course.passingScore,
      changeNote: "İlk kayıt (baseline)",
      createdById,
    },
  });
}
