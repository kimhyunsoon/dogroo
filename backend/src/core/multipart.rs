// dogroo·docook 공통 사본 - 고칠 때 두 곳을 같이 고친다.
//
// @fastify/multipart 9 와 같은 동작:
// - multipart 가 아니면 406 FST_INVALID_MULTIPART_CONTENT_TYPE 'the request is not multipart'
// - filename 이 있는 파트 = 파일, mimetype 은 파트의 Content-Type (없으면 application/octet-stream)
// - 파일 크기 한도 초과는 Part.too_large (호출 쪽이 413 FST_REQ_FILE_TOO_LARGE), 파일 수 한도 초과 413 FST_FILES_LIMIT
use bytes::Bytes;

use super::app::{AppError, Body, Req};

pub struct Part {
    pub fieldname: String,
    pub filename: Option<String>,
    pub mimetype: String,
    pub data: Bytes,
    /// 파일 크기 한도 초과 (toBuffer() 때 413 - 형식 검사보다 뒤라 호출 쪽이 판단)
    pub too_large: bool,
}

impl Part {
    pub fn is_file(&self) -> bool {
        self.filename.is_some()
    }
    pub fn value(&self) -> String {
        String::from_utf8_lossy(&self.data).into_owned()
    }
}

pub struct Limits {
    pub file_size: usize,
    pub files: Option<usize>,
}

fn err(status: u16, code: &str, message: &str) -> AppError {
    AppError {
        status,
        code: Some(code.into()),
        message: message.into(),
    }
}

/// req.parts() 를 끝까지 읽은 결과 (stop_after_first_file: req.file() 처럼 첫 파일에서 멈춤)
pub async fn parts(
    req: &Req,
    limits: &Limits,
    stop_after_first_file: bool,
) -> Result<Vec<Part>, AppError> {
    let Body::Multipart {
        content_type,
        bytes,
    } = &req.body
    else {
        return Err(err(
            406,
            "FST_INVALID_MULTIPART_CONTENT_TYPE",
            "the request is not multipart",
        ));
    };
    let boundary = multer::parse_boundary(content_type).map_err(|_| {
        err(
            406,
            "FST_INVALID_MULTIPART_CONTENT_TYPE",
            "the request is not multipart",
        )
    })?;
    let data = bytes.clone();
    let stream = futures_util::stream::once(async move { Ok::<Bytes, std::io::Error>(data) });
    let mut mp = multer::Multipart::new(stream, boundary);
    let mut out = vec![];
    let mut files = 0;
    while let Some(field) = mp
        .next_field()
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
    {
        let fieldname = field.name().unwrap_or("").to_string();
        let filename = field.file_name().map(String::from);
        let is_file = filename.is_some();
        let mimetype = field
            .content_type()
            .map(|m| m.essence_str().to_string())
            .unwrap_or_else(|| {
                if is_file {
                    "application/octet-stream".into()
                } else {
                    "text/plain".into()
                }
            });
        if is_file {
            files += 1;
            if limits.files.is_some_and(|max| files > max) {
                return Err(err(413, "FST_FILES_LIMIT", "reach files limit"));
            }
        }
        let data = field
            .bytes()
            .await
            .map_err(|e| AppError::internal(e.to_string()))?;
        let too_large = is_file && data.len() > limits.file_size;
        out.push(Part {
            fieldname,
            filename,
            mimetype,
            data,
            too_large,
        });
        if is_file && stop_after_first_file {
            break;
        }
    }
    Ok(out)
}
