import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rqguznglxqgpgduudedu.supabase.co'
const SUPABASE_KEY = 'sb_publishable_g7WUMfz9pKOH3l5emJHECQ_hXu2twml'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)