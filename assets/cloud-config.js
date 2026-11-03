/* TRC cloud settings. Fill in the two PUBLIC values from your Supabase project (Project Settings > API) - see CLOUD-SETUP.md.
   Both are designed to be visible in a website: your data is protected by the database rules in cloud/supabase.sql.
   NEVER put the service_role / secret key here or anywhere in this repository.
   While these are empty, TRC works exactly as before (everything on this device) and the account screen says cloud saving is not set up. */
window.TT_CLOUD = window.TT_CLOUD || { url: '', anonKey: '' };
