// Transactional email sender (stubbed in this study repo).
export async function sendReceiptEmail(
  customerId: string,
  courseId: string,
  amount: string
): Promise<void> {
  void customerId;
  void courseId;
  void amount;
  // In the real service this calls our email provider.
}
