'use strict';

/**
 * Customer-safe card decline copy — discourage blind retries on NSF / hard declines.
 * @param {{ responseText?: string, responseCode?: string, fields?: Record<string, string> }} sale
 */
function formatNmiDeclineMessage(sale) {
    const text = String(sale?.responseText || sale?.fields?.responsetext || '').trim();
    const lower = text.toLowerCase();

    if (
        /insufficient funds|insufficient fund|nsf|not sufficient|decline.*fund|pick.?up card/i.test(
            lower
        )
    ) {
        return 'Your bank declined this card for insufficient funds. Use a different card or contact your bank before trying again — repeated attempts will not succeed with the same card.';
    }

    if (/expired|expiration|invalid exp/i.test(lower)) {
        return 'This card appears to be expired. Check the expiry date or use a different card.';
    }

    if (/cvv|cvc|security code|cid/i.test(lower)) {
        return 'The card security code did not match. Re-enter the CVV from your card and try once more.';
    }

    if (/avs|zip|postal|address verification/i.test(lower)) {
        return 'The billing ZIP or address did not match your card. Confirm the ZIP on your card statement and try again.';
    }

    if (/do not honor|declined|transaction not allowed|restricted/i.test(lower)) {
        return 'Your bank declined this charge. Verify the card details or try a different payment method before placing the order again.';
    }

    if (/duplicate transaction/i.test(lower)) {
        return 'This payment was already submitted. If you were charged, check your email for an order confirmation before trying again.';
    }

    return text || 'Payment was declined. Verify your card details or try a different card.';
}

module.exports = { formatNmiDeclineMessage };
