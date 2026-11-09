//! The same retained compile-time record is inspected by packaging and read by logs.

#[derive(Clone, Copy)]
pub struct BuildIdentity {
    pub source_sha: &'static str,
    pub build_run: &'static str,
}

#[inline(never)]
pub fn compiled_identity() -> BuildIdentity {
    // Prevent constant folding the record into separate substrings: packaging
    // verifies this complete record in the actual ARM binary without executing it.
    let record = std::hint::black_box(env!("BALANCE_COMPILED_IDENTITY"));
    // Compile-time lengths avoid retaining another prefix/suffix pair in
    // rodata that an artifact inspector could mistake for a second record.
    const PREFIX_LEN: usize = "BALANCE_API_IDENTITY_V1[".len();
    const SUFFIX_LEN: usize = "]BALANCE_API_IDENTITY_END".len();
    let fields = record
        .get(PREFIX_LEN..record.len().saturating_sub(SUFFIX_LEN))
        .and_then(|value| value.split_once(':'))
        .expect("validated compile-time identity");
    BuildIdentity {
        source_sha: fields.0,
        build_run: fields.1,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn absent_local_metadata_is_explicitly_unknown() {
        let identity = super::compiled_identity();
        assert_eq!(
            identity.source_sha,
            option_env!("BALANCE_BUILD_SOURCE_SHA").unwrap_or("unknown")
        );
        assert_eq!(
            identity.build_run,
            option_env!("BALANCE_BUILD_RUN_ID").unwrap_or("unknown")
        );
    }
}
