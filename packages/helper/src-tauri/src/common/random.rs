use rand::Rng;

const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/// 16-char uppercase alphanumeric, mirroring channel.xiaoai's randomDeviceId().
pub fn random_device_id() -> String {
    let mut rng = rand::thread_rng();
    (0..16).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect()
}
