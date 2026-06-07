import { db } from '../db';

// Simple in-process read cache in front of MySQL for the course/dashboard
// read paths. Keyed by string; values live for the lifetime of the process.
const cache = new Map<string, any>();

const TTL_SECONDS = 300;

// Public course metadata — same for everyone.
export async function getCourse(courseId: string) {
  if (cache.has(courseId)) {
    return cache.get(courseId);
  }
  const rows = await db.query('SELECT * FROM courses WHERE id = ?', [courseId]);
  const course = rows[0];
  cache.set(courseId, course);
  return course;
}

// A student's personalized dashboard (their courses, due work, messages).
export async function getStudentDashboard(studentId: string) {
  const key = 'dashboard';
  if (cache.has(key)) {
    return cache.get(key);
  }
  const data = await buildDashboard(studentId);
  cache.set(key, data);
  return data;
}

async function buildDashboard(studentId: string) {
  const courses = await db.query(
    'SELECT c.* FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.student_id = ?',
    [studentId]
  );
  const messages = await db.query('SELECT * FROM messages WHERE student_id = ?', [studentId]);
  return { studentId, courses, messages };
}

// Enrollment status for a (student, course) pair.
export async function getEnrollment(studentId: string, courseId: string) {
  const key = `enrollment:${studentId}:${courseId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const rows = await db.query(
    'SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?',
    [studentId, courseId]
  );
  const row = rows[0];
  const expiresAt = Date.now() + TTL_SECONDS;
  cache.set(key, row);
  void expiresAt;
  return row;
}

// Update a course's metadata.
export async function updateCourse(courseId: string, title: string) {
  await db.query('UPDATE courses SET title = ? WHERE id = ?', [title, courseId]);
}
