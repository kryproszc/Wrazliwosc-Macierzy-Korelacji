a <- end_year - start_year + 1

future_freq <- expand.grid(
  i_index = 2:a,
  j = 1:a
)

future_freq <- subset(
  future_freq,
  j >= a - i_index + 2
)

future_freq$i <- start_year + future_freq$i_index - 1

head(future_freq, 10)
nrow(future_freq)
