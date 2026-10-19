import mongoose from 'mongoose';
import { Activity, Team, User, Workout } from '../models/index.js';

export async function listActivities() {
  return Activity.find().lean();
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function inputObject(input: unknown, resource: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw httpError(400, `${resource} request body must be an object`);
  }
  return input as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw httpError(400, `${field} is required`);
  }
  return value.trim();
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) {
    throw httpError(400, `${field} must be a valid ID`);
  }
  return value;
}

function requiredMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw httpError(400, 'minutes must be a positive whole number');
  }
  return value;
}

export async function createActivity(input: unknown) {
  const body = inputObject(input, 'Activity');
  const userId = requiredId(body.userId, 'userId');
  const teamId = requiredId(body.teamId, 'teamId');
  const type = requiredString(body.type, 'type');
  const minutes = requiredMinutes(body.minutes);

  const [user, team] = await Promise.all([User.findById(userId), Team.findById(teamId)]);
  if (!user) throw httpError(404, 'User not found');
  if (!team) throw httpError(404, 'Team not found');

  return Activity.create({
    user: user._id,
    team: team._id,
    type,
    minutes,
    points: minutes,
    occurredAt: new Date(),
  });
}

export async function listTeams() {
  return Team.find().lean();
}

export async function createTeam(input: unknown) {
  const body = inputObject(input, 'Team');
  const name = requiredString(body.name, 'name');
  const mascot = requiredString(body.mascot, 'mascot');
  const rawMembers = body.members ?? [];
  if (!Array.isArray(rawMembers)) throw httpError(400, 'members must be an array of user IDs');
  const memberIds = rawMembers.map((member) => requiredId(member, 'members entry'));
  const uniqueMemberIds = [...new Set(memberIds)];
  const members = await User.find({ _id: { $in: uniqueMemberIds } }).select('_id');
  if (members.length !== uniqueMemberIds.length) throw httpError(404, 'One or more team members were not found');

  return Team.create({ name, mascot, members: members.map((member) => member._id) });
}

export async function getLeaderboard() {
  const [teams, totals] = await Promise.all([
    Team.find().lean(),
    Activity.aggregate<{ _id: mongoose.Types.ObjectId; totalPoints: number }>([
      { $group: { _id: '$team', totalPoints: { $sum: '$points' } } },
    ]),
  ]);
  const pointsByTeam = new Map(totals.map(({ _id, totalPoints }) => [_id.toString(), totalPoints]));
  const leaderboard = teams
    .map((team) => ({ teamName: team.name, totalPoints: pointsByTeam.get(team._id.toString()) ?? 0 }))
    .sort((left, right) => right.totalPoints - left.totalPoints || left.teamName.localeCompare(right.teamName));

  return leaderboard.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export async function suggestWorkouts(userEmail: string) {
  const user = await User.findOne({ email: userEmail.toLowerCase() }).lean();
  if (!user) throw httpError(404, 'User not found');

  const activities = await Activity.find({ user: user._id }).select('type minutes').lean();
  const activityFocus: Record<string, string> = {
    run: 'endurance',
    cycle: 'endurance',
    walk: 'endurance',
    strength: 'strength',
    mobility: 'mobility',
  };
  const minutesByFocus = new Map<string, number>();
  for (const activity of activities) {
    const focus = activityFocus[activity.type];
    if (focus) minutesByFocus.set(focus, (minutesByFocus.get(focus) ?? 0) + activity.minutes);
  }

  const preferredFocus = [...minutesByFocus.entries()]
    .sort(([leftFocus, leftMinutes], [rightFocus, rightMinutes]) =>
      rightMinutes - leftMinutes ||
      Number(rightFocus === user.fitnessGoal) - Number(leftFocus === user.fitnessGoal) ||
      leftFocus.localeCompare(rightFocus),
    )[0]?.[0] ?? user.fitnessGoal;
  const workouts = await Workout.find().lean();

  return workouts
    .map((workout) => {
      const matchesActivity = workout.focus === preferredFocus && minutesByFocus.has(preferredFocus);
      const matchesGoal = workout.focus === user.fitnessGoal;
      const reason = matchesActivity
        ? `Recommended based on your ${preferredFocus} activity pattern`
        : matchesGoal
          ? `Recommended based on your ${user.fitnessGoal} fitness goal`
          : `Suggested to complement your ${preferredFocus} activity pattern`;
      return { ...workout, reason, score: Number(matchesActivity) * 2 + Number(matchesGoal) };
    })
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .map(({ score: _score, ...workout }) => workout);
}

export { User };
