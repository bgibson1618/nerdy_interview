import { db } from '../db';

// Adds private tutor "session notes" to our GraphQL API.
//
// extend type Query {
//   myNotes: [Note!]!
//   studentNotes(studentId: ID!): [Note!]!
//   note(id: ID!): Note!
// }
// extend type Mutation {
//   createNote(studentId: ID!, body: String!): Note!
//   deleteNote(id: ID!): Boolean!
// }
// type Note { id: ID!  body: String!  student: Student!  author: User! }

interface User {
  id: string;
  role: string;
}
interface Context {
  user?: User;
}

export const noteResolvers = {
  Query: {
    // The signed-in tutor's own notes.
    myNotes: async (_p: unknown, _a: unknown, ctx: Context) => {
      if (!ctx.user) throw new Error('Not authenticated');
      return db.query('SELECT * FROM notes WHERE author_id = ? ORDER BY created_at DESC', [
        ctx.user.id,
      ]);
    },

    // All notes recorded for a given student.
    studentNotes: async (_p: unknown, args: { studentId: string }) => {
      return db.query('SELECT * FROM notes WHERE student_id = ?', [args.studentId]);
    },

    note: async (_p: unknown, args: { id: string }) => {
      const rows = await db.query('SELECT * FROM notes WHERE id = ?', [args.id]);
      return rows[0];
    },
  },

  Mutation: {
    createNote: async (
      _p: unknown,
      args: { studentId: string; body: string },
      ctx: Context
    ) => {
      if (!ctx.user) throw new Error('Not authenticated');
      const rows = await db.query(
        'INSERT INTO notes (student_id, author_id, body) VALUES (?, ?, ?) RETURNING *',
        [args.studentId, ctx.user.id, args.body]
      );
      return rows[0];
    },

    deleteNote: async (_p: unknown, args: { id: string }) => {
      await db.query('DELETE FROM notes WHERE id = ?', [args.id]);
      return true;
    },
  },

  Note: {
    // Resolve the note's author into a full User.
    author: async (note: { author_id: string }) => {
      const rows = await db.query('SELECT * FROM users WHERE id = ?', [note.author_id]);
      return rows[0];
    },
  },
};
