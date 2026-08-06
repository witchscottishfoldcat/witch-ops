//! 全局错误类型
//!
//! 所有后端错误统一收敛到 [`AppError`],通过 serde 序列化传给前端。
//! 前端拿到的错误形如 `{ code: "...", message: "..." }`。

use serde::Serialize;
use thiserror::Error;

/// 统一错误码,前端可据此做差异化处理
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// 数据库错误
    Database,
    /// SSH 连接/执行错误
    Ssh,
    /// 指定的服务器未连接
    NotConnected,
    /// 找不到资源(服务器/凭证/技能等)
    NotFound,
    /// 凭证库相关(未解锁、主密码错、解密失败)
    Vault,
    /// 加密/解密失败
    Crypto,
    /// OS keychain 读写失败
    Keychain,
    /// 参数校验失败
    InvalidInput,
    /// 操作被用户取消
    Cancelled,
    /// 其他未分类错误
    Internal,
}

/// 统一错误类型
#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),

    #[error("SSH 错误: {0}")]
    Ssh(String),

    #[error("服务器 {0} 未连接")]
    NotConnected(i64),

    #[error("找不到资源: {0}")]
    NotFound(String),

    #[error("凭证库错误: {0}")]
    Vault(String),

    #[error("加密错误: {0}")]
    Crypto(String),

    #[error("keychain 错误: {0}")]
    Keychain(String),

    #[error("参数错误: {0}")]
    InvalidInput(String),

    #[error("操作已取消")]
    Cancelled,

    #[error("{0}")]
    Internal(String),
}

impl AppError {
    /// 返回机器可读的错误码
    pub fn code(&self) -> ErrorCode {
        match self {
            AppError::Database(_) => ErrorCode::Database,
            AppError::Ssh(_) => ErrorCode::Ssh,
            AppError::NotConnected(_) => ErrorCode::NotConnected,
            AppError::NotFound(_) => ErrorCode::NotFound,
            AppError::Vault(_) => ErrorCode::Vault,
            AppError::Crypto(_) => ErrorCode::Crypto,
            AppError::Keychain(_) => ErrorCode::Keychain,
            AppError::InvalidInput(_) => ErrorCode::InvalidInput,
            AppError::Cancelled => ErrorCode::Cancelled,
            AppError::Internal(_) => ErrorCode::Internal,
        }
    }
}

/// 前端拿到的错误结构
#[derive(Debug, Serialize)]
pub struct SerializableError {
    pub code: ErrorCode,
    pub message: String,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        SerializableError {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

/// 让 anyhow/标准 Result 也能转成 AppError
impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

/// 后端通用的 Result 别名
pub type AppResult<T> = Result<T, AppError>;
