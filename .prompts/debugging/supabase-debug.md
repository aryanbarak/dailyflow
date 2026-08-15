# Supabase Debug — dailyFlow

Debug a Supabase issue in the dailyFlow app.

## Project
- URL: https://taqxwnlwllbywaklwyno.supabase.co
- Client: src/integrations/supabase/client.ts (credentials hardcoded)
- Auth: email + password, RLS enforced on all tables

## Common Issues & Checks

### "Failed to fetch" / NetworkError
- [ ] Is Supabase project paused? (free tier pauses after 7 days inactivity)
  → Fix: Supabase Dashboard → restart project
- [ ] Wrong URL in client.ts?
- [ ] CORS issue? Check browser Network tab → Request URL

### RLS / Permission denied
- [ ] Is user authenticated? Run: `supabase.auth.getUser()`
- [ ] Does RLS policy exist for this table?
  ```sql
  SELECT * FROM pg_policies WHERE tablename = 'your_table';
  ```
- [ ] Is `user_id` filter in query matching `auth.uid()`?
- [ ] Was GRANT statement run?
  ```sql
  GRANT ALL ON your_table TO authenticated;
  ```

### Auth issues
- [ ] Site URL set correctly in Supabase Dashboard?
  → Auth → URL Configuration → Site URL: https://smartaryn.com (task 24 transition; https://barakzai.cloud was the prior value and stays active in parallel during the migration)
- [ ] Redirect URL added? https://smartaryn.com/** (and https://barakzai.cloud/** during the transition)
- [ ] Session expired? Check `supabase.auth.getSession()`

### Storage issues
- [ ] Bucket exists? (documents)
- [ ] Storage policy set for bucket?
- [ ] Signed URL expired? (short lifetime on free tier)

### Data not saving
- [ ] Is `error` checked after every query?
- [ ] Is `user_id` included in INSERT?
- [ ] Check Supabase Dashboard → Table Editor for actual data

## Debug Queries (run in Supabase SQL Editor)

```sql
-- Check RLS policies
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public';

-- Check table data for current user
SELECT * FROM your_table WHERE user_id = auth.uid() LIMIT 10;
```

## Error to Debug:
[PASTE ERROR HERE]

## Code Causing Issue:
[PASTE CODE HERE]
