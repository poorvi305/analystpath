CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL, -- 'registration', 'sign_in', 'sign_out', 'verification', 'password_reset', 'account_suspended', 'account_activated', 'account_deleted'
      user_id TEXT,
      ip_address TEXT,
      details TEXT, -- minimal sanitized info: never passwords, tokens, or credentials
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE call_sessions (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      caller_id TEXT NOT NULL,
      status TEXT DEFAULT 'active', -- 'active', 'ended'
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      FOREIGN KEY (group_id) REFERENCES study_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE career_paths (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      title_hi TEXT NOT NULL,
      domain TEXT NOT NULL,
      tech_intensity TEXT NOT NULL,
      non_tech_friendly TEXT NOT NULL,
      summary TEXT NOT NULL,
      summary_hi TEXT NOT NULL,
      day_to_day TEXT NOT NULL,
      background_applicability TEXT NOT NULL,
      transferable_skills TEXT NOT NULL,
      essential_skills TEXT NOT NULL,
      useful_additions TEXT NOT NULL,
      portfolio_projects TEXT NOT NULL,
      entry_requirements TEXT NOT NULL,
      common_barriers TEXT NOT NULL,
      learning_roadmap TEXT NOT NULL,
      salaries_by_location TEXT NOT NULL,
      pay_variation_factors TEXT NOT NULL,
      hiring_employers TEXT NOT NULL,
      career_progression TEXT NOT NULL,
      skills_gap_checklist TEXT NOT NULL,
      recommended_courses TEXT NOT NULL,
      disclaimer TEXT NOT NULL,
      information_checked_date TEXT NOT NULL,
      order_idx INTEGER NOT NULL
    );

CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      message TEXT NOT NULL,
      lesson_link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES study_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE content_feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      content_type TEXT NOT NULL, -- 'lesson', 'question', 'quiz', 'project'
      content_id TEXT NOT NULL,
      content_title TEXT,
      error_category TEXT NOT NULL, -- 'typo', 'code_bug', 'outdated_link', 'explanation_unclear', 'other'
      description TEXT NOT NULL,
      suggested_fix TEXT,
      status TEXT DEFAULT 'open', -- 'open', 'reviewed', 'corrected', 'dismissed'
      admin_notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

CREATE TABLE courses (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      title_hi TEXT NOT NULL,
      domain TEXT NOT NULL,
      level TEXT NOT NULL,
      icon TEXT NOT NULL,
      estimated_hours INTEGER NOT NULL,
      order_idx INTEGER NOT NULL,
      prerequisites TEXT,
      description TEXT,
      description_hi TEXT,
      learning_objectives TEXT,
      final_project_teaser TEXT
    );

CREATE TABLE customers (
      customer_id INTEGER PRIMARY KEY,
      full_name TEXT,
      email TEXT,
      city TEXT,
      state TEXT,
      segment TEXT,
      signup_date TEXT
    );

CREATE TABLE employee_churn (
      emp_id TEXT PRIMARY KEY,
      department TEXT,
      tenure_months INTEGER,
      satisfaction_score REAL,
      last_evaluation REAL,
      monthly_salary REAL,
      left_company INTEGER
    );

CREATE TABLE group_invitations (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT,
      max_uses INTEGER DEFAULT 10,
      uses INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES study_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

CREATE TABLE group_milestones (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      achieved_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES study_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE group_reactions (
      id TEXT PRIMARY KEY,
      milestone_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reaction_type TEXT NOT NULL, -- 'celebrate', 'fire', 'star', 'rocket', 'clap'
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (milestone_id) REFERENCES group_milestones(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE group_shared_goals (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      goal_text TEXT NOT NULL,
      target_date TEXT,
      is_completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES study_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE guided_projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_hi TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      difficulty TEXT NOT NULL,
      estimated_hours INTEGER NOT NULL,
      skills TEXT NOT NULL, -- JSON array
      scenario_en TEXT NOT NULL,
      scenario_hi TEXT NOT NULL,
      dataset_name TEXT,
      steps TEXT NOT NULL, -- JSON array
      rubric TEXT NOT NULL, -- JSON array
      portfolio_template TEXT NOT NULL
    );

CREATE TABLE interview_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      user_answer TEXT NOT NULL,
      score INTEGER,
      feedback_en TEXT,
      feedback_hi TEXT,
      completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE interview_questions (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      question_en TEXT NOT NULL,
      question_hi TEXT NOT NULL,
      model_answer_en TEXT NOT NULL,
      model_answer_hi TEXT NOT NULL,
      key_points TEXT NOT NULL -- JSON array
    , sub_category TEXT, stage TEXT, role_type TEXT, skill_assessed TEXT, answer_structure TEXT, common_pitfalls TEXT, detailed_explanation TEXT);

CREATE TABLE lesson_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      status TEXT DEFAULT 'not_started', -- 'in_progress', 'completed'
      completed_at TEXT, mode_studied TEXT DEFAULT 'reading', test_score INTEGER DEFAULT 0, test_passed INTEGER DEFAULT 0, test_attempts INTEGER DEFAULT 0, last_watched_seconds INTEGER DEFAULT 0, video_language TEXT DEFAULT 'en',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
    );

CREATE TABLE lessons (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      title TEXT NOT NULL,
      title_hi TEXT NOT NULL,
      slug TEXT NOT NULL,
      estimated_minutes INTEGER DEFAULT 25,
      order_idx INTEGER NOT NULL,
      content_en TEXT,
      content_hi TEXT,
      key_terms TEXT,
      formula_sheet TEXT,
      worked_examples TEXT,
      common_mistakes TEXT,
      external_resources TEXT,
      practice_exercise TEXT, video_url TEXT, video_duration TEXT, video_summary TEXT, video_script TEXT, video_transcript TEXT, lesson_test TEXT, video_url_hi TEXT, video_duration_hi TEXT, video_summary_hi TEXT, video_script_hi TEXT, video_transcript_hi TEXT, video_status TEXT DEFAULT 'pending', video_provider TEXT DEFAULT 'heygen', avatar_model TEXT DEFAULT 'ananya-data-mentor',
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

CREATE TABLE orders (
      order_id INTEGER PRIMARY KEY,
      customer_id INTEGER,
      product_id INTEGER,
      order_date TEXT,
      quantity INTEGER,
      discount_pct REAL,
      total_amount REAL,
      payment_status TEXT,
      shipping_region TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
      FOREIGN KEY (product_id) REFERENCES products(product_id)
    );

CREATE TABLE products (
      product_id INTEGER PRIMARY KEY,
      product_name TEXT,
      category TEXT,
      sub_category TEXT,
      unit_cost REAL,
      unit_price REAL,
      stock_qty INTEGER
    );

CREATE TABLE question_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      user_response TEXT,
      is_correct INTEGER,
      score REAL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    );

CREATE TABLE questions (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      difficulty TEXT NOT NULL, -- 'Beginner', 'Intermediate', 'Advanced'
      question_type TEXT NOT NULL, -- 'mcq', 'short_answer', 'code_task', 'scenario'
      title TEXT NOT NULL,
      title_hi TEXT,
      prompt_en TEXT NOT NULL,
      prompt_hi TEXT,
      code_snippet TEXT,
      options TEXT, -- JSON array for MCQs
      hint_en TEXT,
      hint_hi TEXT,
      solution_en TEXT NOT NULL,
      solution_hi TEXT,
      explanation_en TEXT NOT NULL,
      explanation_hi TEXT,
      rubric TEXT, -- JSON array of scoring criteria
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

CREATE TABLE quiz_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      quiz_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      max_score INTEGER NOT NULL,
      percentage REAL NOT NULL,
      weak_topics TEXT, -- JSON array
      completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE quiz_questions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      question_en TEXT NOT NULL,
      question_hi TEXT NOT NULL,
      options TEXT NOT NULL, -- JSON array
      correct_answer TEXT NOT NULL,
      explanation_en TEXT,
      explanation_hi TEXT,
      topic_tag TEXT,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );

CREATE TABLE quizzes (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      title TEXT NOT NULL,
      title_hi TEXT NOT NULL,
      pass_score INTEGER DEFAULT 75,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE study_group_members (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member', -- 'admin' or 'member'
      share_progress INTEGER DEFAULT 1,
      share_milestones INTEGER DEFAULT 1,
      share_hours INTEGER DEFAULT 1,
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP, share_scores INTEGER DEFAULT 0, share_photo INTEGER DEFAULT 0, share_phone INTEGER DEFAULT 0, share_role_info INTEGER DEFAULT 0,
      UNIQUE(group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES study_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE study_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

CREATE TABLE study_schedule (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date_str TEXT NOT NULL,
      day_name TEXT NOT NULL,
      task_title TEXT NOT NULL,
      task_title_hi TEXT NOT NULL,
      course_id TEXT,
      duration_minutes INTEGER DEFAULT 45,
      is_completed INTEGER DEFAULT 0,
      is_rescheduled INTEGER DEFAULT 0, task_type TEXT DEFAULT 'lesson', notes TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE user_blocks (
      id TEXT PRIMARY KEY,
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(blocker_id, blocked_id),
      FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE user_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      note_text TEXT NOT NULL,
      is_shared INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, lesson_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE user_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT DEFAULT 'in_progress', -- 'in_progress', 'submitted', 'evaluated'
      submission_notes TEXT,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES guided_projects(id) ON DELETE CASCADE
    );

CREATE TABLE user_reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL,
      reported_user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT,
      status TEXT DEFAULT 'pending', -- 'pending', 'resolved', 'dismissed'
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT DEFAULT 'learner',
      is_verified INTEGER DEFAULT 0,
      verification_token TEXT,
      reset_token TEXT,
      reset_token_expires TEXT,
      current_level TEXT DEFAULT 'Beginner',
      target_role TEXT DEFAULT 'Junior Data Analyst',
      preferred_language TEXT DEFAULT 'hinglish',
      hours_per_week INTEGER DEFAULT 10,
      target_date TEXT,
      xp INTEGER DEFAULT 0,
      streak_days INTEGER DEFAULT 0,
      last_active TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    , status TEXT DEFAULT 'active', phone TEXT, last_login_at TEXT, photo_url TEXT, current_status TEXT DEFAULT 'Career switcher', job_title TEXT, industry TEXT, phone_verified INTEGER DEFAULT 0, phone_otp TEXT, phone_otp_expires TEXT, ai_daily_requests_count INTEGER DEFAULT 0, ai_daily_requests_reset TEXT, phone_verification_code TEXT, phone_code_expires TEXT, employment_status TEXT DEFAULT 'Unemployed / looking for work', share_phone INTEGER DEFAULT 0, share_photo INTEGER DEFAULT 0, share_employment_status INTEGER DEFAULT 0, share_job_title INTEGER DEFAULT 0, profile_photo TEXT, onboarding_role TEXT DEFAULT 'Career switcher', current_job_title TEXT, current_industry TEXT, is_phone_verified INTEGER DEFAULT 0, preferred_country TEXT DEFAULT 'US', share_profile_photo INTEGER DEFAULT 0, share_current_role INTEGER DEFAULT 0, share_employer_info INTEGER DEFAULT 0);

CREATE TABLE video_generation_jobs (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      provider TEXT NOT NULL DEFAULT 'heygen',
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'generating', 'ready', 'failed'
      external_job_id TEXT,
      video_url TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
    );