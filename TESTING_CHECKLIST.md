# HM Herbs - Complete Testing Checklist

Use this checklist to verify all functionality of your website.

## 📋 Pre-Testing Setup

### Prerequisites
- [ ] Node.js installed (v16+)
- [ ] MySQL database installed and running
- [ ] Backend dependencies installed (`cd backend && npm install`)
- [ ] Google Calendar API package installed (`cd backend && npm install googleapis`)
- [ ] Database created and schema imported
- [ ] `.env` file configured in `backend/` directory
- [ ] Backend server running (`cd backend && npm start`)
- [ ] Frontend server running (Python HTTP server or Live Server)

## 🏠 Home Page (index.html) Testing

### Visual Checks
- [ ] Page loads without errors
- [ ] No console errors (F12 → Console tab)
- [ ] Header/navigation bar displays correctly
- [ ] Logo displays properly
- [ ] All navigation links visible and on one line
- [ ] Search icon fully visible (not cut off)
- [ ] Shopping cart icon visible
- [ ] Hero section displays
- [ ] Product spotlight section shows products
- [ ] Health categories section displays
- [ ] EDSA service section displays with image
- [ ] Footer displays with correct contact info
- [ ] No horizontal scrolling
- [ ] Page starts at top (doesn't auto-scroll)

### Functionality Checks
- [ ] Navigation links work (Home, Products, Health Conditions, etc.)
- [ ] Search icon opens search dropdown
- [ ] Search functionality works (try searching for a product)
- [ ] Shopping cart icon opens cart sidebar
- [ ] Cart closes when clicking X or overlay
- [ ] Cookie consent banner appears (if not accepted)
- [ ] Cookie banner closes when "Accept All" is clicked
- [ ] Cookie banner doesn't reappear after accepting
- [ ] Mobile menu toggles (if testing on mobile/resized window)
- [ ] All images load correctly
- [ ] No broken image links

## 🛍️ Products Page (products.html) Testing

### Visual Checks
- [ ] Page loads without errors
- [ ] Product grid displays products
- [ ] Product cards are properly aligned
- [ ] "Add to Cart" buttons are at same level across cards
- [ ] Product images display
- [ ] Product titles are readable (not cut off)
- [ ] Product descriptions display
- [ ] Prices display correctly
- [ ] Stock status indicators show
- [ ] Navigation bar works correctly

### Functionality Checks
- [ ] Search bar filters products
- [ ] Search works with keywords (not just exact phrases)
- [ ] Category filter works
- [ ] Brand filter works
- [ ] "Add to Cart" button adds product to cart
- [ ] Cart updates when product added
- [ ] Can add multiple products
- [ ] Can add same product multiple times
- [ ] Product cards are clickable (if links are implemented)

## 🛒 Shopping Cart Testing

### Cart Opening/Closing
- [ ] Cart opens when cart icon clicked
- [ ] Cart closes when X button clicked
- [ ] Cart closes when overlay clicked
- [ ] Cart doesn't get stuck open
- [ ] Body scroll is disabled when cart is open
- [ ] Body scroll is enabled when cart is closed

### Cart Functionality
- [ ] Items appear in cart when added
- [ ] Product name displays correctly
- [ ] Product price displays correctly
- [ ] Quantity displays correctly
- [ ] Can increase quantity (+ button)
- [ ] Can decrease quantity (- button)
- [ ] Can remove items (X button)
- [ ] Total price calculates correctly
- [ ] Subtotal displays correctly
- [ ] Cart persists on page refresh (localStorage)
- [ ] Empty cart message shows when no items
- [ ] "Checkout" or "Continue Shopping" buttons work (if implemented)

## 📅 EDSA Booking System Testing

### Modal Opening
- [ ] "Book EDSA Session" button opens modal
- [ ] Modal displays correctly
- [ ] Modal overlay appears
- [ ] Can close modal with X button
- [ ] Can close modal by clicking overlay
- [ ] Can close modal with Escape key
- [ ] Body scroll disabled when modal open

### Calendar Functionality
- [ ] Calendar displays current month
- [ ] Can navigate to previous month (← button)
- [ ] Can navigate to next month (→ button)
- [ ] Month/year header updates correctly
- [ ] Past dates are disabled (can't click)
- [ ] Today is highlighted
- [ ] Can select a date
- [ ] Selected date is highlighted

### Time Slot Selection
- [ ] Time slots appear after selecting date
- [ ] Time slots display in readable format (e.g., "2:00 PM")
- [ ] Can select a time slot
- [ ] Selected time slot is highlighted
- [ ] Time slots are appropriate for business hours
- [ ] No time slots show for past dates

### Booking Form
- [ ] Form displays after selecting date and time
- [ ] All form fields are visible
- [ ] First Name field required
- [ ] Last Name field required
- [ ] Email field required and validates format
- [ ] Phone field required
- [ ] Notes field is optional
- [ ] Form validation works (shows errors for invalid input)
- [ ] Can submit form
- [ ] Success message appears after submission
- [ ] Modal closes after successful booking
- [ ] Form resets after submission

### Google Calendar Integration (if configured)
- [ ] Calendar event is created in HM Herbs' Google Calendar
- [ ] Event includes customer information
- [ ] Event includes correct date and time
- [ ] Event includes location
- [ ] Email notifications sent (if configured)

## 🔍 Search Functionality Testing

### Home Page Search
- [ ] Search dropdown opens when search icon clicked
- [ ] Can type in search input
- [ ] Search works with keywords (not just exact phrases)
- [ ] Search results display
- [ ] Can click on search results
- [ ] Search closes when clicking outside

### Products Page Search
- [ ] Search bar filters products in real-time
- [ ] Search works with partial product names
- [ ] Search works with keywords from descriptions
- [ ] Search works with category names
- [ ] Search works with brand names
- [ ] Search clears when input is cleared
- [ ] No results message shows when no matches

## 📱 Responsive Design Testing

### Mobile View (< 768px)
- [ ] Navigation menu collapses to hamburger menu
- [ ] Mobile menu opens/closes correctly
- [ ] All content is readable
- [ ] Buttons are large enough to tap
- [ ] Images scale properly
- [ ] No horizontal scrolling
- [ ] Cart works on mobile
- [ ] EDSA booking modal works on mobile

### Tablet View (768px - 1024px)
- [ ] Layout adapts correctly
- [ ] Navigation displays properly
- [ ] Product grid adjusts
- [ ] All features work

### Desktop View (> 1024px)
- [ ] Full layout displays
- [ ] All navigation items on one line
- [ ] Product grid shows multiple columns
- [ ] All features work

## 🔐 Admin Panel Testing (admin.html)

### Login
- [ ] Admin page loads
- [ ] Login form displays
- [ ] Can enter email and password
- [ ] Login button works
- [ ] Error message shows for invalid credentials
- [ ] Successfully logs in with valid credentials
- [ ] Redirects to dashboard after login

### Dashboard
- [ ] Dashboard displays statistics
- [ ] Product counts show
- [ ] Order statistics show
- [ ] User statistics show
- [ ] EDSA booking statistics show

### Product Management
- [ ] Products list loads
- [ ] Can create new product
- [ ] Can edit existing product
- [ ] Can delete product
- [ ] Product images upload
- [ ] Form validation works

### Order Management
- [ ] Orders list loads
- [ ] Can view order details
- [ ] Can update order status
- [ ] Order information displays correctly

### EDSA Bookings Management
- [ ] Bookings list loads
- [ ] Can view booking details
- [ ] Can update booking status
- [ ] Can add admin notes
- [ ] Booking information displays correctly

## 🌐 Browser Compatibility Testing

Test in multiple browsers:
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari (if on Mac)
- [ ] Mobile browsers (iOS Safari, Chrome Mobile)

## ⚡ Performance Testing

- [ ] Page loads quickly (< 3 seconds)
- [ ] Images load progressively
- [ ] No JavaScript errors in console
- [ ] No network errors
- [ ] Smooth scrolling
- [ ] Animations are smooth
- [ ] No memory leaks (check with browser dev tools)

## 🔒 Security Testing

- [ ] No sensitive data in console
- [ ] API endpoints require authentication (where needed)
- [ ] CORS is properly configured
- [ ] Input validation works
- [ ] XSS protection (test with script tags in inputs)
- [ ] SQL injection protection (test with SQL in inputs)

## 📊 Backend API Testing

Use curl, Postman, or browser to test:

### Public Endpoints
- [ ] `GET /api/health` - Health check
- [ ] `GET /api/public/products` - Get products
- [ ] `GET /api/edsa/info` - Get EDSA service info
- [ ] `GET /api/edsa/available-slots?date=YYYY-MM-DD` - Get available time slots

### Booking Endpoints
- [ ] `POST /api/edsa/book` - Create booking
- [ ] `GET /api/edsa/bookings` - Get user bookings (requires auth)
- [ ] `PUT /api/edsa/bookings/:id/cancel` - Cancel booking

### Admin Endpoints (requires auth)
- [ ] `POST /api/admin/auth/login` - Admin login
- [ ] `GET /api/admin/dashboard/stats` - Dashboard stats
- [ ] `GET /api/admin/products` - List products
- [ ] `GET /api/admin/orders` - List orders
- [ ] `GET /api/admin/edsa/bookings` - List EDSA bookings

## 🐛 Common Issues to Check

- [ ] No console errors
- [ ] No 404 errors for missing files
- [ ] No CORS errors
- [ ] No database connection errors
- [ ] No authentication errors
- [ ] Images load correctly
- [ ] Fonts load correctly
- [ ] CSS styles apply correctly
- [ ] JavaScript functions execute
- [ ] Forms submit correctly
- [ ] API calls succeed

## ✅ Final Verification

Before going live, verify:
- [ ] All critical features work
- [ ] No console errors
- [ ] All links work
- [ ] All forms work
- [ ] Mobile responsive
- [ ] Cross-browser compatible
- [ ] Performance is acceptable
- [ ] Security measures in place
- [ ] Database is backed up
- [ ] Environment variables are set
- [ ] Google Calendar is configured (if using)
- [ ] Email service is configured (if using)

## 📝 Notes

Document any issues found:
- Issue: _______________________
- Location: ____________________
- Severity: [ ] Critical [ ] High [ ] Medium [ ] Low
- Status: [ ] Fixed [ ] In Progress [ ] Pending

---

**Testing Date:** _______________
**Tester:** _______________
**Browser/Version:** _______________
**OS:** _______________

