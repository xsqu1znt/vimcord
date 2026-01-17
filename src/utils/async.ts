export async function retryExponentialBackoff<T>(
    fn: (attempt: number) => Promise<T>,
    maxRetries = 3,
    retryDelay = 1_000
): Promise<T> {
    let attempts = 0;

    while (true) {
        try {
            return await fn(attempts);
        } catch (error) {
            if (attempts >= maxRetries) throw error;
            await new Promise(resolve => setTimeout(resolve, Math.pow(1.75, attempts) * retryDelay + Math.random() * 500));
            attempts++;
        }
    }
}
