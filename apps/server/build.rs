use std::env;

fn main() {
    println!("cargo:rerun-if-env-changed=BALANCE_BUILD_SOURCE_SHA");
    println!("cargo:rerun-if-env-changed=BALANCE_BUILD_RUN_ID");
    let source = env::var("BALANCE_BUILD_SOURCE_SHA");
    let run = env::var("BALANCE_BUILD_RUN_ID");
    let (source, run) = match (source, run) {
        (Err(env::VarError::NotPresent), Err(env::VarError::NotPresent)) => {
            ("unknown".to_owned(), "unknown".to_owned())
        }
        (Ok(source), Ok(run))
            if source.len() == 40
                && source
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                && !run.is_empty()
                && run.len() <= 20
                && !run.starts_with('0')
                && run.bytes().all(|b| b.is_ascii_digit()) =>
        {
            (source, run)
        }
        _ => panic!("build source and run identity must both be absent or valid"),
    };
    println!(
        "cargo:rustc-env=BALANCE_COMPILED_IDENTITY=BALANCE_API_IDENTITY_V1[{source}:{run}]BALANCE_API_IDENTITY_END"
    );
}
