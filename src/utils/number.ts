export function formatThousands(num: number, sep = ",") {
    return `${num}`.replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, sep);
}
