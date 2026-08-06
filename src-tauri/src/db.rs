//! 数据库连接与初始化
//!
//! 单一 SQLite 数据库(借鉴 MaidKit 的单 AppDatabase 策略)。
//! 所有表集中在 [`migrations/0001_init.sql`],schema 变更走迁移文件。

use std::path::Path;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;

use crate::error::{AppError, AppResult};

/// 数据库连接池别名
pub type Db = SqlitePool;

/// 初始化数据库连接池并执行迁移。
///
/// 数据库文件位于 `data_dir/app.db`。WAL 模式开启以提升并发。
pub async fn init_db(data_dir: &Path) -> AppResult<Db> {
    // 确保数据目录存在
    std::fs::create_dir_all(data_dir)
        .map_err(|e| AppError::Internal(format!("创建数据目录失败: {e}")))?;

    let db_path = data_dir.join("app.db");
    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // 执行初始 schema(多语句 DDL,用 raw_sql)
    let schema = include_str!("../migrations/0001_init.sql");
    sqlx::raw_sql(schema).execute(&pool).await.map_err(|e| {
        log::error!("执行初始 schema 失败: {e}");
        AppError::Database(e)
    })?;

    log::info!("数据库已初始化: {}", db_path.display());
    Ok(pool)
}

/// 读取单个标量值(`SELECT count(*)` 之类)
#[allow(dead_code)]
pub async fn count_rows(db: &Db, table: &str) -> AppResult<i64> {
    // table 名不能参数化,这里白名单校验
    debug_assert!(
        table.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
        "表名仅允许字母数字下划线"
    );
    let sql = format!("SELECT COUNT(*) AS c FROM {table}");
    let row = sqlx::query(&sql).fetch_one(db).await?;
    Ok(row.try_get::<i64, _>("c").unwrap_or(0))
}
