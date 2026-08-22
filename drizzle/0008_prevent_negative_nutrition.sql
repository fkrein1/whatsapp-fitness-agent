CREATE TRIGGER meal_items_reject_negative_insert
BEFORE INSERT ON meal_items
WHEN NEW.quantity < 0
  OR NEW.calories_kcal < 0
  OR NEW.protein_grams < 0
  OR NEW.carbs_grams < 0
  OR NEW.fat_grams < 0
BEGIN
  SELECT RAISE(ABORT, 'meal nutrition values cannot be negative');
END;
--> statement-breakpoint
CREATE TRIGGER meal_items_reject_negative_update
BEFORE UPDATE OF quantity, calories_kcal, protein_grams, carbs_grams, fat_grams ON meal_items
WHEN NEW.quantity < 0
  OR NEW.calories_kcal < 0
  OR NEW.protein_grams < 0
  OR NEW.carbs_grams < 0
  OR NEW.fat_grams < 0
BEGIN
  SELECT RAISE(ABORT, 'meal nutrition values cannot be negative');
END;
