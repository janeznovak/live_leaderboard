This project involves creating a backend system for a real-time leaderboard service. The service will allow users to compete in various games or activities, track their scores, and view their rankings on a leaderboard. The system will feature user authentication, score submission, real-time leaderboard updates, and score history tracking. Redis sorted sets will be used to manage and query the leaderboards efficiently.

Project Requirements
You are to build an imaginary real-time leaderboard system that ranks users based on their scores in various games or activities. The system should meet the following requirements:

User Authentication: Users should be able to register and log in to the system.

Score Submission: Users should be able to submit their scores for different games or activities.

Leaderboard Updates: Display a global leaderboard showing the top users across all games.

User Rankings: Users should be able to view their rankings on the leaderboard.

Top Players Report: Generate reports on the top players for a specific period.

Tip - Use Redis Sorted Sets
Leaderboard Storage: Use Redis sorted sets to store and manage leaderboards.

Real-Time Updates: Utilize Redis sorted sets for efficient real-time updates and queries.

Rank Queries: Use Redis commands to query user ranks and leaderboard positions