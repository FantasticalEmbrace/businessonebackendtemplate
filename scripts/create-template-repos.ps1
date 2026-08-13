$ErrorActionPreference = 'Stop'
$source = 'c:\Users\donal\OneDrive\Desktop\Web SItes\hmherbs-main'
$parent = 'c:\Users\donal\OneDrive\Desktop\Web SItes'

$giftRepo = Join-Path $parent 'Gift Card Template'
$loyaltyRepo = Join-Path $parent 'Loyalty Program Template'

function Ensure-Dir($path) {
    if (-not (Test-Path $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
}

function Copy-IfExists($src, $dest) {
    if (Test-Path $src) {
        $destDir = Split-Path $dest -Parent
        Ensure-Dir $destDir
        Copy-Item $src $dest -Force
        return $true
    }
    Write-Warning "Missing: $src"
    return $false
}

# --- Gift Card Template ---
if (Test-Path $giftRepo) { Remove-Item $giftRepo -Recurse -Force }
Ensure-Dir $giftRepo

$giftCopies = @(
    @("$source\backend\routes\gift-cards.js", "$giftRepo\backend\routes\gift-cards.js"),
    @("$source\backend\routes\admin-gift-cards.js", "$giftRepo\backend\routes\admin-gift-cards.js"),
    @("$source\backend\services\giftCardCheckout.js", "$giftRepo\backend\services\giftCardCheckout.js"),
    @("$source\backend\services\giftCardFulfillment.js", "$giftRepo\backend\services\giftCardFulfillment.js"),
    @("$source\backend\services\giftCardDeliveryEmail.js", "$giftRepo\backend\services\giftCardDeliveryEmail.js"),
    @("$source\backend\services\giftCardRecipientAccount.js", "$giftRepo\backend\services\giftCardRecipientAccount.js"),
    @("$source\backend\utils\giftCardCodes.js", "$giftRepo\backend\utils\giftCardCodes.js"),
    @("$source\backend\utils\ensureGiftCardCatalog.js", "$giftRepo\backend\utils\ensureGiftCardCatalog.js"),
    @("$source\backend\utils\ensureGiftCardPurchaseSchema.js", "$giftRepo\backend\utils\ensureGiftCardPurchaseSchema.js"),
    @("$source\database\migrations\20260604_gift_card_purchase.sql", "$giftRepo\database\migrations\20260604_gift_card_purchase.sql"),
    @("$source\gift-cards.html", "$giftRepo\frontend\gift-cards.html"),
    @("$source\css\gift-cards.css", "$giftRepo\frontend\css\gift-cards.css"),
    @("$source\js\gift-cards.js", "$giftRepo\frontend\js\gift-cards.js"),
    @("$source\backend\services\pos-giftcard.js", "$giftRepo\backend\services\pos-giftcard.js"),
    @("$source\backend\scripts\verify-customer-schema.js", "$giftRepo\backend\scripts\verify-customer-schema.js"),
    @("$source\backend\scripts\purge-customer-account.js", "$giftRepo\backend\scripts\purge-customer-account.js")
)

foreach ($pair in $giftCopies) { Copy-IfExists $pair[0] $pair[1] | Out-Null }

# Admin + checkout + account (full files with cross-feature code noted in README)
Copy-IfExists "$source\admin-customers.js" "$giftRepo\admin\admin-customers.js" | Out-Null
Copy-IfExists "$source\admin-app.js" "$giftRepo\admin\admin-app.js" | Out-Null
Copy-IfExists "$source\admin.html" "$giftRepo\admin\admin.html" | Out-Null
Copy-IfExists "$source\checkout.html" "$giftRepo\frontend\checkout.html" | Out-Null
Copy-IfExists "$source\js\checkout.js" "$giftRepo\frontend\js\checkout.js" | Out-Null
Copy-IfExists "$source\account.html" "$giftRepo\frontend\account.html" | Out-Null
Copy-IfExists "$source\js\account.js" "$giftRepo\frontend\js\account.js" | Out-Null
Copy-IfExists "$source\backend\routes\orders.js" "$giftRepo\backend\routes\orders.js" | Out-Null
Copy-IfExists "$source\backend\services\finalizePaidOrder.js" "$giftRepo\backend\services\finalizePaidOrder.js" | Out-Null
Copy-IfExists "$source\backend\services\webPromotionEngine.js" "$giftRepo\backend\services\webPromotionEngine.js" | Out-Null
Copy-IfExists "$source\backend\services\analytics.js" "$giftRepo\backend\services\analytics.js" | Out-Null
Copy-IfExists "$source\backend\routes\admin.js" "$giftRepo\backend\routes\admin-pos-gift-cards.snippet.js" | Out-Null
Copy-IfExists "$source\backend\utils\adminRoles.js" "$giftRepo\backend\utils\adminRoles.js" | Out-Null

# --- Loyalty Program Template ---
if (Test-Path $loyaltyRepo) { Remove-Item $loyaltyRepo -Recurse -Force }
Ensure-Dir $loyaltyRepo

$loyaltyCopies = @(
    @("$source\backend\services\pos-loyalty.js", "$loyaltyRepo\backend\services\pos-loyalty.js"),
    @("$source\backend\utils\provisionCustomerProfile.js", "$loyaltyRepo\backend\utils\provisionCustomerProfile.js"),
    @("$source\backend\routes\admin-customers.js", "$loyaltyRepo\backend\routes\admin-customers.js"),
    @("$source\backend\scripts\verify-customer-schema.js", "$loyaltyRepo\backend\scripts\verify-customer-schema.js"),
    @("$source\backend\scripts\purge-customer-account.js", "$loyaltyRepo\backend\scripts\purge-customer-account.js"),
    @("$source\backend\services\analytics.js", "$loyaltyRepo\backend\services\analytics.js"),
    @("$source\admin-customers.js", "$loyaltyRepo\admin\admin-customers.js"),
    @("$source\admin.html", "$loyaltyRepo\admin\admin.html"),
    @("$source\account.html", "$loyaltyRepo\frontend\account.html"),
    @("$source\js\account.js", "$loyaltyRepo\frontend\js\account.js")
)

foreach ($pair in $loyaltyCopies) { Copy-IfExists $pair[0] $pair[1] | Out-Null }

Copy-IfExists "$source\backend\routes\admin.js" "$loyaltyRepo\backend\routes\admin-pos-loyalty.snippet.js" | Out-Null

# SQL + integration + README
Copy-IfExists "$source\scripts\template-sql\gift_cards_schema.sql" "$giftRepo\database\migrations\001_gift_cards_schema.sql" | Out-Null
Copy-IfExists "$source\scripts\template-integration\gift-card-server-mounts.js" "$giftRepo\integration\server-mounts.js" | Out-Null
Copy-IfExists "$source\scripts\template-readme\GIFT-CARD-README.md" "$giftRepo\README.md" | Out-Null

Copy-IfExists "$source\scripts\template-sql\loyalty_schema.sql" "$loyaltyRepo\database\migrations\001_loyalty_schema.sql" | Out-Null
Copy-IfExists "$source\scripts\template-integration\loyalty-server-mounts.js" "$loyaltyRepo\integration\server-mounts.js" | Out-Null
Copy-IfExists "$source\scripts\template-readme\LOYALTY-README.md" "$loyaltyRepo\README.md" | Out-Null

# .gitignore for both
$gitignore = @"
node_modules/
.env
.env.*
*.log
.DS_Store
Thumbs.db
"@
Set-Content -Path (Join-Path $giftRepo '.gitignore') -Value $gitignore -Encoding UTF8
Set-Content -Path (Join-Path $loyaltyRepo '.gitignore') -Value $gitignore -Encoding UTF8

Write-Host "Gift Card Template: $giftRepo"
Write-Host "Loyalty Program Template: $loyaltyRepo"
