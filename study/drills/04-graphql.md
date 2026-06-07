## StudyHall tutoring API — GraphQL resolvers (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import gql from 'graphql-tag';
import { GraphQLJSON } from 'graphql-type-json';
import { db } from './db';
import { verifyToken } from './auth';

const typeDefs = gql`
  scalar JSON

  type Query {
    me: User
    courses: [Course!]!
    course(id: ID!): Course
    student(id: ID!): Student
    tutoringSession(id: ID!): TutoringSession
  }

  type Mutation {
    bookSession(courseId: ID!, minutes: Int!): TutoringSession!
  }

  type User {
    id: ID!
    email: String!
    role: String!
  }

  type Student {
    id: ID!
    name: String!
    email: String!
    enrolledCourses: [Course!]!
    profile: JSON
  }

  type Course {
    id: ID!
    title: String!
    tutor: Tutor!
    students: [Student!]!
  }

  type Tutor {
    id: ID!
    name: String!
    bio: String
  }

  type TutoringSession {
    id: ID!
    course: Course!
    student: Student!
    minutes: Int!
  }
`;

const resolvers = {
  JSON: GraphQLJSON,

  Query: {
    me: async (_parent, _args, context) => {
      if (!context.user) throw new Error('Not authenticated');
      return db.users.findById(context.user.id);
    },

    courses: async () => {
      return db.courses.findAll();
    },

    course: async (_parent, { id }) => {
      return db.courses.findById(id);
    },

    student: async (_parent, { id }, context) => {
      return db.students.findById(id);
    },

    tutoringSession: async (_parent, { id }) => {
      try {
        return await db.sessions.findById(id);
      } catch (err) {
        throw new Error(`Could not load session ${id}: ${err.stack}`);
      }
    },
  },

  Mutation: {
    bookSession: async (_parent, { courseId, minutes }, context) => {
      if (!context.user) throw new Error('Not authenticated');
      return db.sessions.create({
        courseId,
        studentId: context.user.id,
        minutes,
      });
    },
  },

  Course: {
    students: async (course) => {
      return db.students.findByCourseId(course.id);
    },
    tutor: async (course) => {
      return db.tutors.findById(course.tutorId);
    },
  },

  Student: {
    enrolledCourses: async (student) => {
      return db.courses.findByStudentId(student.id);
    },
    profile: (student) => {
      return student;
    },
  },
};

const server = new ApolloServer({ typeDefs, resolvers });

startStandaloneServer(server, {
  context: async ({ req }) => {
    const token = req.headers.authorization || '';
    const user = token ? verifyToken(token) : null;
    return { user };
  },
  listen: { port: 4000 },
});
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Authorization):** `Query.student(id)` returns `db.students.findById(id)` for *any* id and never looks at `context.user`. Any logged-in student can read every other student's record just by changing the id (this class of bug is called IDOR / broken object-level authorization). It slips past because the resolver looks just like `course` next to it, and GraphQL has **no built-in per-object auth** — every resolver that returns sensitive data must check ownership itself. *Fix:* verify the caller may see this record (e.g. `context.user.id === id || context.user.role === 'ADMIN'`) and throw a `ForbiddenError` otherwise.

2. **Blocker (Data exposure):** `Student.profile` is a custom `JSON` scalar whose resolver is `return student` — the entire DB row. Normally GraphQL only sends the fields you declared in the schema, so extra columns stay hidden; but a `JSON` scalar serializes whatever object you hand it **verbatim**, bypassing field selection. So `passwordHash`, `resetToken`, and anything else on the row ship straight to the client. It slips past because the schema line (`profile: JSON`) looks innocent and the resolver is a one-liner. *Fix:* return an explicit projection (`{ bio: student.bio, gradeLevel: student.gradeLevel }`) — never feed a raw DB row to a JSON scalar.

3. **Blocker (Correctness — schema/runtime mismatch):** `Course.tutor` is declared non-null (`Tutor!`), but the resolver returns `db.tutors.findById(course.tutorId)`, which is `null` for a course with no tutor assigned yet. When a non-null field resolves to `null`, GraphQL doesn't just null that field — it **errors the field and propagates the null upward**, nulling the whole `Course`; and because `courses: [Course!]!` is a non-null list of non-null items, one tutor-less course errors the *entire* `courses` query for every client. It slips past because it only fires on a data state ("course without a tutor") the author never tested locally. *Fix:* make it nullable (`tutor: Tutor`) to match reality, or guarantee a tutor always exists before the course is queryable.

4. **Should-fix (Performance — N+1):** `Course.students` (and `Student.enrolledCourses`) issue **one DB query per parent object**. A query like `courses { students { name } }` runs one query for the course list, then *N more* — one per course. GraphQL makes this trap easy because field resolvers run independently for each parent, so an innocent-looking nested query silently fans out into hundreds of round-trips. *Fix:* batch with a **DataLoader** — one `students.findByCourseIds([...])` per tick — created per request and stashed on `context` (the standard Apollo pattern).

5. **Should-fix (DoS — no query limits):** `new ApolloServer({ typeDefs, resolvers })` sets no depth or complexity limit, and the schema is cyclic (`Course.students` → `Student.enrolledCourses` → `Course.students` …). A single client can send a deeply nested or aliased query that expands exponentially and exhausts CPU and the DB — a valid token is all it takes. `courses: db.courses.findAll()` with no pagination compounds it. It slips past because the bug is what's *absent*, not a line you can point at. *Fix:* add a depth limit (e.g. `graphql-depth-limit`) and/or a query-cost plugin via `validationRules`, and paginate list fields.

6. **Should-fix (Error handling — info leak):** `tutoringSession`'s catch rethrows `` `Could not load session ${id}: ${err.stack}` `` — the raw stack trace (file paths, library internals, sometimes query fragments) goes to the client. It slips past because wrapping an error *feels* like good hygiene. *Fix:* log the full error server-side, return a generic client-facing message, and rely on Apollo's `formatError` to strip internals in production.

7. **Nit (Input validation):** `bookSession` takes `minutes: Int!` and passes it straight into `db.sessions.create` with no bounds check — `0`, `-30`, and `100000` are all accepted. The `!` only guarantees an integer is present, not that it's sane. *Fix:* validate (e.g. `minutes > 0 && minutes <= 240`) and throw a `UserInputError` on bad input.

8. **Praise (Authorization done right):** `me` is the pattern the rest of the file should copy — it ignores any client-supplied id, checks `context.user`, and reads `context.user.id` straight from the verified token. Identity comes from the authenticated **context**, never from arguments. Use this resolver as your reference when explaining why `student` (#1) and `profile` (#2) are wrong: the secure shape already exists three resolvers up.

**Senior framing to say out loud:** "I'd block this PR on the data-access bugs — `student` has no object-level authorization so any id leaks any student, `profile: JSON` ships the raw row including the password hash, and the non-null `tutor` errors whole `courses` requests the moment real data has an unassigned course. I'd want the N+1, the missing depth/complexity limits, and the stack trace in the error path fixed before it takes production traffic; the `minutes` validation is a quick cleanup a linter or a test would catch. The good news is `me` already shows the correct context-driven auth pattern, so the fixes are about applying a pattern that's already in the file, not inventing one."
</details>
